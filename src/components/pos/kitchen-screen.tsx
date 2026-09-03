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
import { LanguageProvider, useLanguage, STAFF_LANGUAGE_STORAGE_KEY } from './language-context';

// キッチンモニター画面 (2026-09-03 追加)。Tomからの要望「あとはどうやってレジプリンターと
// キッチンに情報を送るかを改めて考えましょう。(中略) キッチンはハンディーのようにキッチン
// モニターに設定すればキッチンモニターとして使えるようになれば簡単です」に対応。
//
// 紙の厨房伝票 (プリンター) の代わりに、確定・厨房送信された注文品目をこの画面に一覧表示し、
// 「調理完了」をタップすると一覧から消える (誤操作対策として、直近に完了した品目は「最近完了」
// セクションから「元に戻す」で復帰できる)。既存の厨房プリンター機能とは完全に独立しており、
// 印刷を併用している店舗にも影響しない。ハンディ (§0.1c) と同様、タブレット等を1台
// キッチンに据え置いて使うことを想定 (POS PIN ログイン後、画面を開いたままにする運用)。
//
// POS PIN ログイン・matsunoya-dine連携ログインのどちらでも使える (この画面が使う
// /api/pos-order/kitchen-tickets/* は他の /api/pos-order/* 系と同じく認証なしの公開API のため、
// §0.1h のような PosNativeOnlyNotice 制限は不要)。

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

export function KitchenScreen() {
  return (
    <LanguageProvider storageKey={STAFF_LANGUAGE_STORAGE_KEY} defaultLang="ja">
      <KitchenScreenInner />
    </LanguageProvider>
  );
}

const POLL_INTERVAL_MS = 6000;

function KitchenScreenInner() {
  const { t } = useLanguage();
  const router = useRouter();
  const me = useStaff();

  const [pending, setPending] = useState<KitchenTicketItem[]>([]);
  const [recentlyDone, setRecentlyDone] = useState<KitchenTicketItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [, setTick] = useState(0);

  const load = useCallback(() => {
    getKitchenTickets()
      .then((r) => {
        setPending(r.pending);
        setRecentlyDone(r.recentlyDone);
        setError(null);
      })
      .catch((err) => setError(err instanceof PosOrderKitchenApiError ? err.message : t('kitchen.loadError')));
  }, [t]);

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
      setError(err instanceof PosOrderKitchenApiError ? err.message : t('kitchen.actionError'));
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
      setError(err instanceof PosOrderKitchenApiError ? err.message : t('kitchen.actionError'));
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
      <div className="flex flex-shrink-0 items-center gap-3 border-b border-border px-5 py-3">
        <button onClick={() => router.push('/pos')} className="flex h-9 items-center rounded-lg border border-border bg-card px-3 text-[13px] font-semibold">
          ← {t('common.backToRegister')}
        </button>
        <div className="text-[15px] font-bold">{t('kitchen.title')}</div>
      </div>
      <div className="flex-1 overflow-auto p-5">
        <div className="mx-auto flex max-w-[900px] flex-col gap-6">
          {error && <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-[12.5px] text-destructive">{error}</div>}

          <div>
            <div className="mb-2.5 text-[13px] font-semibold text-muted-foreground">{t('kitchen.pendingHeading')}</div>
            {pending.length === 0 ? (
              <div className="rounded-xl border border-border bg-card p-5 text-[13px] text-muted-foreground">{t('kitchen.emptyPending')}</div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {pending.map((item) => {
                  const minutes = elapsedMinutes(item.sent_to_kitchen_at);
                  const optionsLabel = item.selected_options.map((o) => o.choiceLabel).join(' / ');
                  return (
                    <div key={item.id} className={`flex flex-col gap-2 rounded-xl border-2 p-4 ${urgencyClass(minutes)}`}>
                      <div className="flex items-center justify-between">
                        <div className="text-[14px] font-bold">{item.table_code ?? t('kitchen.noTable')}</div>
                        <div className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${urgencyBadgeClass(minutes)}`}>
                          {minutes === 0 ? t('kitchen.justNow') : t('kitchen.elapsedMinutes', { minutes: String(minutes) })}
                        </div>
                      </div>
                      <div className="text-[15px] font-semibold leading-snug">
                        {item.menu_name} × {item.qty}
                      </div>
                      {optionsLabel && <div className="text-[12px] text-muted-foreground">{optionsLabel}</div>}
                      <button
                        type="button"
                        onClick={() => handleDone(item)}
                        disabled={busyIds.has(item.id)}
                        className="mt-1 h-10 rounded-lg bg-primary text-[13px] font-bold text-primary-foreground disabled:opacity-50"
                      >
                        {t('kitchen.doneButton')}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <div className="mb-2.5 text-[13px] font-semibold text-muted-foreground">{t('kitchen.recentlyDoneHeading')}</div>
            {recentlyDone.length === 0 ? (
              <div className="text-[12.5px] text-muted-foreground">{t('kitchen.emptyRecentlyDone')}</div>
            ) : (
              <div className="flex flex-col gap-2">
                {recentlyDone.map((item) => (
                  <div key={item.id} className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-2.5">
                    <div className="text-[12.5px]">
                      <span className="font-semibold">{item.table_code ?? t('kitchen.noTable')}</span> ・ {item.menu_name} × {item.qty}
                      {item.kitchen_done_by_name && <span className="ml-2 text-muted-foreground">{t('kitchen.doneBy', { name: item.kitchen_done_by_name })}</span>}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleUndo(item)}
                      disabled={busyIds.has(item.id)}
                      className="h-8 rounded-md border border-border px-3 text-[11.5px] font-semibold disabled:opacity-50"
                    >
                      {t('kitchen.undoButton')}
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
