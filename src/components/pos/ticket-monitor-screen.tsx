'use client';

import { useCallback, useEffect, useState } from 'react';
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

export function TicketMonitorScreen({ kind, ns, fontSizeStorageKey }: { kind: 'food' | 'drink'; ns: 'kitchen' | 'drink'; fontSizeStorageKey: string }) {
  const { t } = useLanguage();
  const router = useRouter();
  const me = useStaff();

  const [allPending, setAllPending] = useState<KitchenTicketItem[]>([]);
  const [allRecentlyDone, setAllRecentlyDone] = useState<KitchenTicketItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [, setTick] = useState(0);
  const [fontSize, setFontSize] = useState<FontSize>('md');

  useEffect(() => {
    setFontSize(loadFontSize(fontSizeStorageKey));
  }, [fontSizeStorageKey]);

  function changeFontSize(size: FontSize) {
    setFontSize(size);
    try {
      window.localStorage.setItem(fontSizeStorageKey, size);
    } catch {
      // localStorage が使えない環境でも画面表示自体は継続する
    }
  }

  const pending = allPending.filter((item) => item.kind === kind);
  const recentlyDone = allRecentlyDone.filter((item) => item.kind === kind);
  const cls = FONT_SIZE_CLASSES[fontSize];

  const load = useCallback(() => {
    getKitchenTickets()
      .then((r) => {
        setAllPending(r.pending);
        setAllRecentlyDone(r.recentlyDone);
        setError(null);
      })
      .catch((err) => setError(err instanceof PosOrderKitchenApiError ? err.message : t(`${ns}.loadError`)));
  }, [t, ns]);

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
                {pending.map((item) => {
                  const minutes = elapsedMinutes(item.sent_to_kitchen_at);
                  const optionsLabel = item.selected_options.map((o) => o.choiceLabel).join(' / ');
                  return (
                    <div key={item.id} className={`flex flex-col gap-2 rounded-xl border-2 p-4 ${urgencyClass(minutes)}`}>
                      <div className="flex items-center justify-between">
                        <div className={`font-bold ${cls.table}`}>{item.table_code ?? t(`${ns}.noTable`)}</div>
                        <div className={`rounded-full px-2 py-0.5 font-semibold ${cls.badge} ${urgencyBadgeClass(minutes)}`}>
                          {minutes === 0 ? t(`${ns}.justNow`) : t(`${ns}.elapsedMinutes`, { minutes: String(minutes) })}
                        </div>
                      </div>
                      <div className={`font-semibold leading-snug ${cls.name}`}>
                        {item.menu_name} × {item.qty}
                      </div>
                      {optionsLabel && <div className={`text-muted-foreground ${cls.options}`}>{optionsLabel}</div>}
                      <button
                        type="button"
                        onClick={() => handleDone(item)}
                        disabled={busyIds.has(item.id)}
                        className="mt-1 h-10 rounded-lg bg-primary text-[13px] font-bold text-primary-foreground disabled:opacity-50"
                      >
                        {t(`${ns}.doneButton`)}
                      </button>
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
                      <span className="font-semibold">{item.table_code ?? t(`${ns}.noTable`)}</span> ・ {item.menu_name} × {item.qty}
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
