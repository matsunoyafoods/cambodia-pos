'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStaff } from './staff-context';
import {
  getKitchenTickets,
  markKitchenTicketDone,
  undoKitchenTicketDone,
  PosOrderKitchenApiError,
  type KitchenTicketItem,
} from '@/lib/pos-order-kitchen-client';
import { useLanguage } from './language-context';

// キッチンモニター/ドリンカーモニター 共通実装 (2026-09-04 追加。元々 kitchen-screen.tsx に
// あった実装を、ドリンカーモニター追加にあたって kind ('food' | 'drink') で出し分けできる
// よう共通化した。データ取得元 (/api/pos-order/kitchen-tickets) は1本のまま — 各品目に
// サーバー側で付与された kind で、この画面がクライアント側で絞り込むだけ。「調理完了」
// 「提供完了」ボタンの操作対象 (order_items.kitchen_done_at) も共通のため、レジ画面
// (ConfirmedItemRow) から直接「提供完了」にした品目も、両モニターの「最近完了」に
// 正しく反映される。
//
// 文字サイズ切替 (2026-09-04 追加。Tomからの要望「あとキッチンモニターの
// 200g / ライス / Coke / ミディアムレア などの文字が小さい。表示方法をカスタムできるように
// してください」への対応)。画面内の切替ボタンで 小/中/大 を選べ、選択は端末ごとに
// localStorage へ記憶する (キッチン用タブレットとドリンク用タブレットで別々に記憶されるよう、
// namespace ごとにキーを分ける)。

const POLL_INTERVAL_MS = 6000;

type FontSize = 'sm' | 'md' | 'lg';

const FONT_SIZE_CLASSES: Record<FontSize, { table: string; badge: string; name: string; options: string; doneRow: string }> = {
  sm: { table: 'text-[13px]', badge: 'text-[10px]', name: 'text-[14px]', options: 'text-[12px]', doneRow: 'text-[12px]' },
  md: { table: 'text-[15px]', badge: 'text-[11px]', name: 'text-[17px]', options: 'text-[14px]', doneRow: 'text-[13px]' },
  lg: { table: 'text-[18px]', badge: 'text-[12.5px]', name: 'text-[21px]', options: 'text-[17px]', doneRow: 'text-[15px]' },
};

function elapsedMinutes(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
}

// 待ち時間が長いほど目立たせる (滞在タイマー・飲み放題タイマーと同じ考え方: 黄色→赤)。
function urgencyClass(minutes: number): string {
  if (minutes >= 15) return 'border-destructive/60 bg-destructive/5';
  if (minutes >= 8) return 'border-amber-300 bg-amber-50';
  return 'border-border bg-card';
}

function urgencyBadgeClass(minutes: number): string {
  if (minutes >= 15) return 'bg-destructive text-destructive-foreground';
  if (minutes >= 8) return 'bg-amber-400 text-amber-950';
  return 'bg-secondary text-muted-foreground';
}

function loadFontSize(storageKey: string): FontSize {
  if (typeof window === 'undefined') return 'md';
  const v = window.localStorage.getItem(storageKey);
  return v === 'sm' || v === 'md' || v === 'lg' ? v : 'md';
}

// 新規注文チャイム (2026-09-04 追加。Tom「注文が入った時に音が鳴らないと気づきません」→
// 「さすがにこれじゃ気づかないでしょ。音と長さを選べるようにしてほしい」への対応)。外部
// 音声ファイルを持ち込まず Web Audio API のオシレーターで音を生成する軽量な実装。タブレット
// 画面を常時見ていなくても、新しい品目が届いたことに気づけるようにする。ブラウザの自動再生
// 制限により、そのタブレットで一度も画面操作 (「調理完了」ボタン等のタップ) をしていない
// 状態だと最初の1回は鳴らないことがあるが、このモニター画面は常に操作しながら使う前提のため
// 実運用上は問題にならない。
//
// 「音」(音色) と「長さ」(繰り返し回数) をそれぞれ選べるようにした。特に「長さ」は
// 厨房のような騒がしい環境でも気づけるよう、1回だけでなく何度も鳴らし続けられるようにする
// のが狙い (Tom「これじゃ気づかない」)。
export type MonitorSoundType = 'ping' | 'beep' | 'alarm';
export type MonitorSoundRepeat = 1 | 3 | 6;
export type MonitorSoundSettings = { enabled: boolean; type: MonitorSoundType; repeat: MonitorSoundRepeat };

const DEFAULT_SOUND_SETTINGS: MonitorSoundSettings = { enabled: true, type: 'ping', repeat: 1 };
const SOUND_TYPES: MonitorSoundType[] = ['ping', 'beep', 'alarm'];
const SOUND_REPEATS: MonitorSoundRepeat[] = [1, 3, 6];

// 音色ごとのパターン定義。1回分の音 (freqs を順に鳴らす) を、長さ設定の回数分だけ間隔を
// 空けて繰り返す。ping=やわらかい2音、beep=短く鋭い単音連打、alarm=目立つサイレン風の2音
// (波形をノコギリ波にして音量も上げ、聞き逃しにくくしてある)。
const SOUND_PATTERNS: Record<MonitorSoundType, { freqs: number[]; noteMs: number; type: OscillatorType; gain: number }> = {
  ping: { freqs: [880, 1320], noteMs: 160, type: 'sine', gain: 0.35 },
  beep: { freqs: [1200, 1200], noteMs: 110, type: 'square', gain: 0.3 },
  alarm: { freqs: [660, 990], noteMs: 220, type: 'sawtooth', gain: 0.45 },
};

function playNewOrderChime(settings: Pick<MonitorSoundSettings, 'type' | 'repeat'>) {
  try {
    type AudioContextCtor = typeof AudioContext;
    const AudioCtx: AudioContextCtor | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const pattern = SOUND_PATTERNS[settings.type];
    const unitMs = pattern.freqs.length * pattern.noteMs;
    const gapMs = 240; // 繰り返し (長さ設定) 1回ごとの間の無音
    let cursorMs = 0;
    for (let r = 0; r < settings.repeat; r++) {
      pattern.freqs.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = pattern.type;
        osc.frequency.value = freq;
        const start = now + (cursorMs + i * pattern.noteMs) / 1000;
        const dur = pattern.noteMs / 1000;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(pattern.gain, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, start + dur * 0.9);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + dur);
      });
      cursorMs += unitMs + gapMs;
    }
    setTimeout(() => ctx.close(), cursorMs + 400);
  } catch {
    // 音声再生に失敗しても画面表示自体は継続する
  }
}

function loadSoundSettings(storageKey: string): MonitorSoundSettings {
  if (typeof window === 'undefined') return DEFAULT_SOUND_SETTINGS;
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return DEFAULT_SOUND_SETTINGS;
  // 旧バージョン ('on'/'off' の文字列のみ) との互換。
  if (raw === 'off') return { ...DEFAULT_SOUND_SETTINGS, enabled: false };
  if (raw === 'on') return DEFAULT_SOUND_SETTINGS;
  try {
    const parsed = JSON.parse(raw) as Partial<MonitorSoundSettings>;
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULT_SOUND_SETTINGS.enabled,
      type: parsed.type && SOUND_TYPES.includes(parsed.type) ? parsed.type : DEFAULT_SOUND_SETTINGS.type,
      repeat: parsed.repeat && SOUND_REPEATS.includes(parsed.repeat) ? parsed.repeat : DEFAULT_SOUND_SETTINGS.repeat,
    };
  } catch {
    return DEFAULT_SOUND_SETTINGS;
  }
}

function saveSoundSettings(storageKey: string, settings: MonitorSoundSettings) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(settings));
  } catch {
    // localStorage が使えない環境でも画面表示自体は継続する
  }
}

// テーブルごとにカードをまとめる (2026-09-04 変更。Tomからの要望「商品ごとではなくて
// テーブルごとで分けて欲しい。商品の横に提供済みボタンがあって押したら提供完了になる」
// への対応)。以前は品目1件につき1カードだったが、同じテーブルの品目を1枚のカードに
// まとめ、カード内の各品目に個別の「調理完了/提供完了」ボタンを置く形に変更した。
// テーブル未設定 (table_code が null、例: テイクアウト) の品目は品目ごとに別カードとして扱う。
type TableGroup = {
  key: string;
  tableCode: string | null;
  items: KitchenTicketItem[];
  oldestSentAt: string;
};

function groupByTable(items: KitchenTicketItem[]): TableGroup[] {
  const map = new Map<string, TableGroup>();
  for (const item of items) {
    const key = item.table_code ?? `__no_table_${item.id}`;
    let group = map.get(key);
    if (!group) {
      group = { key, tableCode: item.table_code, items: [], oldestSentAt: item.sent_to_kitchen_at };
      map.set(key, group);
    }
    group.items.push(item);
    if (new Date(item.sent_to_kitchen_at).getTime() < new Date(group.oldestSentAt).getTime()) {
      group.oldestSentAt = item.sent_to_kitchen_at;
    }
  }
  const groups = Array.from(map.values());
  for (const group of groups) {
    group.items.sort((a, b) => new Date(a.sent_to_kitchen_at).getTime() - new Date(b.sent_to_kitchen_at).getTime());
  }
  groups.sort((a, b) => new Date(a.oldestSentAt).getTime() - new Date(b.oldestSentAt).getTime());
  return groups;
}

export function TicketMonitorScreen({ kind, ns, fontSizeStorageKey }: { kind: 'food' | 'drink'; ns: 'kitchen' | 'drink'; fontSizeStorageKey: string }) {
  const { t, menuText } = useLanguage();
  const router = useRouter();
  const me = useStaff();

  const [allPending, setAllPending] = useState<KitchenTicketItem[]>([]);
  const [allRecentlyDone, setAllRecentlyDone] = useState<KitchenTicketItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [, setTick] = useState(0);
  const [fontSize, setFontSize] = useState<FontSize>('md');
  const soundStorageKey = `posMonitorSound:${ns}`;
  const [soundSettings, setSoundSettings] = useState<MonitorSoundSettings>(DEFAULT_SOUND_SETTINGS);
  const soundSettingsRef = useRef<MonitorSoundSettings>(DEFAULT_SOUND_SETTINGS);
  const [soundPanelOpen, setSoundPanelOpen] = useState(false);
  // このモニター (kind) がこれまでに見た保留中の品目ID。null のうちは「初回読み込み前」の
  // 意味で、初回取得時に鳴らさないようにするためのガード。
  const knownPendingIdsRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    setFontSize(loadFontSize(fontSizeStorageKey));
  }, [fontSizeStorageKey]);

  useEffect(() => {
    const loaded = loadSoundSettings(soundStorageKey);
    setSoundSettings(loaded);
    soundSettingsRef.current = loaded;
    // 画面 (kind) が変わったら「初回読み込み」扱いに戻す。
    knownPendingIdsRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soundStorageKey]);

  function changeFontSize(size: FontSize) {
    setFontSize(size);
    try {
      window.localStorage.setItem(fontSizeStorageKey, size);
    } catch {
      // localStorage が使えない環境でも画面表示自体は継続する
    }
  }

  function updateSoundSettings(patch: Partial<MonitorSoundSettings>) {
    const next = { ...soundSettingsRef.current, ...patch };
    setSoundSettings(next);
    soundSettingsRef.current = next;
    saveSoundSettings(soundStorageKey, next);
  }

  function toggleSound() {
    updateSoundSettings({ enabled: !soundSettingsRef.current.enabled });
  }

  const pending = allPending.filter((item) => item.kind === kind);
  const recentlyDone = allRecentlyDone.filter((item) => item.kind === kind);
  const cls = FONT_SIZE_CLASSES[fontSize];
  const tableGroups = useMemo(() => groupByTable(pending), [pending]);

  const load = useCallback(() => {
    getKitchenTickets()
      .then((r) => {
        setAllPending(r.pending);
        setAllRecentlyDone(r.recentlyDone);
        setError(null);

        // このモニター (kind) にとって新規の品目が増えていたらチャイムを鳴らす。初回読み込み時
        // (knownPendingIdsRef.current === null) は既存の保留品目全部が「新規」に見えてしまうため
        // 対象外にする。
        const idsForKind = new Set(r.pending.filter((it) => it.kind === kind).map((it) => it.id));
        if (knownPendingIdsRef.current !== null) {
          let hasNew = false;
          for (const id of idsForKind) {
            if (!knownPendingIdsRef.current.has(id)) {
              hasNew = true;
              break;
            }
          }
          if (hasNew && soundSettingsRef.current.enabled) playNewOrderChime(soundSettingsRef.current);
        }
        knownPendingIdsRef.current = idsForKind;
      })
      .catch((err) => setError(err instanceof PosOrderKitchenApiError ? err.message : t(`${ns}.loadError`)));
  }, [t, ns, kind]);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [load]);

  // 経過時間の表示・色分けを1分ごとに再計算するためだけの再描画トリガー
  // (データ自体はポーリングで取得済み、サーバーへの追加リクエストは発生しない)。
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60000);
    return () => clearInterval(id);
  }, []);

  async function handleDone(item: KitchenTicketItem) {
    setBusyIds((s) => new Set(s).add(item.id));
    try {
      await markKitchenTicketDone(item.id, me.display_name);
      load();
    } catch (err) {
      setError(err instanceof PosOrderKitchenApiError ? err.message : t(`${ns}.actionError`));
    } finally {
      setBusyIds((s) => {
        const next = new Set(s);
        next.delete(item.id);
        return next;
      });
    }
  }

  // テーブルカードを2秒長押しすると、そのテーブルの品目を全て一括で完了にする
  // (2026-09-04 追加。Tomからの要望「注文商品が5個の場合、5回注文完了を押さないと完了に
  // なりません。なのでこの機能を残しつつ2秒長押ししたら5個全て提供完了になるように」への
  // 対応)。品目ごとの個別ボタンはそのまま残し、カード見出し部分の長押しで一括完了できる
  // ようにする。一括APIは無いため Promise.all で個別APIを並行実行する。
  const HOLD_DURATION_MS = 2000;
  const [holdingGroupKey, setHoldingGroupKey] = useState<string | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function cancelHold() {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    setHoldingGroupKey(null);
  }

  function startHold(group: TableGroup) {
    if (group.items.length < 2) return; // 1品だけなら個別ボタンで十分
    setHoldingGroupKey(group.key);
    holdTimerRef.current = setTimeout(() => {
      handleBulkDone(group);
      setHoldingGroupKey(null);
    }, HOLD_DURATION_MS);
  }

  async function handleBulkDone(group: TableGroup) {
    const ids = group.items.map((it) => it.id);
    setBusyIds((s) => {
      const next = new Set(s);
      for (const id of ids) next.add(id);
      return next;
    });
    try {
      await Promise.all(ids.map((id) => markKitchenTicketDone(id, me.display_name)));
      load();
    } catch (err) {
      setError(err instanceof PosOrderKitchenApiError ? err.message : t(`${ns}.actionError`));
    } finally {
      setBusyIds((s) => {
        const next = new Set(s);
        for (const id of ids) next.delete(id);
        return next;
      });
    }
  }

  useEffect(() => {
    return () => {
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    };
  }, []);

  async function handleUndo(item: KitchenTicketItem) {
    setBusyIds((s) => new Set(s).add(item.id));
    try {
      await undoKitchenTicketDone(item.id);
      load();
    } catch (err) {
      setError(err instanceof PosOrderKitchenApiError ? err.message : t(`${ns}.actionError`));
    } finally {
      setBusyIds((s) => {
        const next = new Set(s);
        next.delete(item.id);
        return next;
      });
    }
  }

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-background">
      <div className="flex flex-shrink-0 flex-wrap items-center gap-3 border-b border-border px-5 py-3">
        <button onClick={() => router.push('/pos')} className="flex h-9 items-center rounded-lg border border-border bg-card px-3 text-[13px] font-semibold">
          ← {t('common.backToRegister')}
        </button>
        <div className="text-[15px] font-bold">{t(`${ns}.title`)}</div>
        <div className="ml-auto flex items-center gap-1.5">
          {/* 音のON/OFFはワンタップで即切り替え、音色・長さは横の⚙から選ぶ (2026-09-04 追加。
              Tom「さすがにこれじゃ気づかないでしょ。音と長さを選べるようにしてほしい」)。 */}
          <button
            type="button"
            onClick={toggleSound}
            title={t(soundSettings.enabled ? 'monitor.soundOnHint' : 'monitor.soundOffHint')}
            className={
              'flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11.5px] font-semibold ' +
              (soundSettings.enabled ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground')
            }
          >
            <span>{soundSettings.enabled ? '🔔' : '🔕'}</span>
            {t(soundSettings.enabled ? 'monitor.soundOn' : 'monitor.soundOff')}
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setSoundPanelOpen((v) => !v)}
              title={t('monitor.soundSettingsTitle')}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-[13px] text-muted-foreground"
            >
              ⚙
            </button>
            {soundPanelOpen && (
              <>
                <button aria-label="close sound settings" onClick={() => setSoundPanelOpen(false)} className="fixed inset-0 z-10 cursor-default" />
                <div className="absolute right-0 top-[calc(100%+8px)] z-20 w-64 rounded-xl border border-border bg-card p-3.5 shadow-lg">
                  <div className="mb-2 text-[11.5px] font-semibold text-muted-foreground">{t('monitor.soundTypeLabel')}</div>
                  <div className="mb-3 flex gap-1.5">
                    {SOUND_TYPES.map((tp) => (
                      <button
                        key={tp}
                        type="button"
                        onClick={() => updateSoundSettings({ type: tp })}
                        className={
                          'h-8 flex-1 rounded-md border text-[11.5px] font-semibold ' +
                          (soundSettings.type === tp ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-foreground')
                        }
                      >
                        {t(`monitor.soundType.${tp}`)}
                      </button>
                    ))}
                  </div>
                  <div className="mb-2 text-[11.5px] font-semibold text-muted-foreground">{t('monitor.soundLengthLabel')}</div>
                  <div className="mb-3 flex gap-1.5">
                    {SOUND_REPEATS.map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => updateSoundSettings({ repeat: n })}
                        className={
                          'h-8 flex-1 rounded-md border text-[11.5px] font-semibold ' +
                          (soundSettings.repeat === n ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-foreground')
                        }
                      >
                        {t(`monitor.soundRepeat.${n}`)}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => playNewOrderChime(soundSettings)}
                    className="h-9 w-full rounded-lg bg-secondary text-[12.5px] font-semibold text-foreground"
                  >
                    ▶ {t('monitor.soundTest')}
                  </button>
                </div>
              </>
            )}
          </div>
          <span className="text-[11px] text-muted-foreground">{t('monitor.fontSizeLabel')}</span>
          <div className="flex gap-1 rounded-lg bg-secondary p-0.5">
            {(['sm', 'md', 'lg'] as const).map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => changeFontSize(size)}
                className={
                  'h-7 rounded-md px-2.5 text-[11.5px] font-semibold ' +
                  (fontSize === size ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground')
                }
              >
                {size === 'sm' ? t('monitor.fontSizeSmall') : size === 'md' ? t('monitor.fontSizeMedium') : t('monitor.fontSizeLarge')}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-5">
        <div className="mx-auto flex max-w-[900px] flex-col gap-6">
          {error && <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-[12.5px] text-destructive">{error}</div>}

          <div>
            <div className="mb-2.5 text-[13px] font-semibold text-muted-foreground">{t(`${ns}.pendingHeading`)}</div>
            {pending.length === 0 ? (
              <div className="rounded-xl border border-border bg-card p-5 text-[13px] text-muted-foreground">{t(`${ns}.emptyPending`)}</div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {tableGroups.map((group) => {
                  const minutes = elapsedMinutes(group.oldestSentAt);
                  const canBulkComplete = group.items.length >= 2;
                  const isHolding = holdingGroupKey === group.key;
                  return (
                    <div key={group.key} className={`flex flex-col gap-2.5 rounded-xl border-2 p-4 ${urgencyClass(minutes)}`}>
                      <div
                        className={'select-none ' + (canBulkComplete ? 'cursor-pointer' : '')}
                        onPointerDown={canBulkComplete ? () => startHold(group) : undefined}
                        onPointerUp={canBulkComplete ? cancelHold : undefined}
                        onPointerLeave={canBulkComplete ? cancelHold : undefined}
                        onPointerCancel={canBulkComplete ? cancelHold : undefined}
                        title={canBulkComplete ? t(`${ns}.holdAllHint`) : undefined}
                      >
                        <div className="flex items-center justify-between">
                          <div className={`font-bold ${cls.table}`}>{group.tableCode ?? t(`${ns}.noTable`)}</div>
                          <div className={`rounded-full px-2 py-0.5 font-semibold ${cls.badge} ${urgencyBadgeClass(minutes)}`}>
                            {minutes === 0 ? t(`${ns}.justNow`) : t(`${ns}.elapsedMinutes`, { minutes: String(minutes) })}
                          </div>
                        </div>
                        {canBulkComplete && (
                          <>
                            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-black/10">
                              <div
                                className="h-full rounded-full bg-primary"
                                style={{
                                  width: isHolding ? '100%' : '0%',
                                  transition: isHolding ? `width ${HOLD_DURATION_MS}ms linear` : 'none',
                                }}
                              />
                            </div>
                            <div className="mt-1 text-[10px] text-muted-foreground">{t(`${ns}.holdAllHint`)}</div>
                          </>
                        )}
                      </div>
                      <div className="flex flex-col gap-2">
                        {group.items.map((item) => {
                          const optionsLabel = item.selected_options.map((o) => menuText(o.choiceLabel, o.translations)).join(' / ');
                          return (
                            <div
                              key={item.id}
                              className="flex items-center justify-between gap-2.5 border-t border-border/60 pt-2 first:border-t-0 first:pt-0"
                            >
                              <div className="min-w-0 flex-1">
                                <div className={`font-semibold leading-snug ${cls.name}`}>
                                  {menuText(item.menu_name, item.menu_translations)} × {item.qty}
                                </div>
                                {optionsLabel && <div className={`text-muted-foreground ${cls.options}`}>{optionsLabel}</div>}
                              </div>
                              <button
                                type="button"
                                onClick={() => handleDone(item)}
                                disabled={busyIds.has(item.id)}
                                className="h-10 shrink-0 rounded-lg bg-primary px-3 text-[13px] font-bold text-primary-foreground disabled:opacity-50"
                              >
                                {t(`${ns}.doneButton`)}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <div className="mb-2.5 text-[13px] font-semibold text-muted-foreground">{t(`${ns}.recentlyDoneHeading`)}</div>
            {recentlyDone.length === 0 ? (
              <div className="text-[12.5px] text-muted-foreground">{t(`${ns}.emptyRecentlyDone`)}</div>
            ) : (
              <div className="flex flex-col gap-2">
                {recentlyDone.map((item) => (
                  <div key={item.id} className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-2.5">
                    <div className={cls.doneRow}>
                      <span className="font-semibold">{item.table_code ?? t(`${ns}.noTable`)}</span> ・{' '}
                      {menuText(item.menu_name, item.menu_translations)} × {item.qty}
                      {item.kitchen_done_by_name && <span className="ml-2 text-muted-foreground">{t(`${ns}.doneBy`, { name: item.kitchen_done_by_name })}</span>}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleUndo(item)}
                      disabled={busyIds.has(item.id)}
                      className="h-8 rounded-md border border-border px-3 text-[11.5px] font-semibold disabled:opacity-50"
                    >
                      {t(`${ns}.undoButton`)}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
