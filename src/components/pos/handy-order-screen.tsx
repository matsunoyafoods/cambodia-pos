'use client';

import { useEffect, useState } from 'react';
import type { CartLine, MenuImageStyle, MenuItem } from '@/lib/pos-types';
import { money } from '@/lib/money';
import type { TableSessionRecord } from '@/lib/table-session-client';
import type { OrderItemRecord } from '@/lib/pos-order-orders-client';
import { drinkTimerState, elapsedMinutes, formatDuration } from '@/lib/table-timer';
import { effectiveBasePrice } from '@/lib/happy-hour';

// ハンディ端末向けの注文入力画面 (2026-08-31 追加。「ハンディ注文機能」)。
// レジ画面の OrderScreen (order-screen.tsx) をそのまま流用すると、固定340pxのカート
// サイドバー・3カラム決め打ちのメニューグリッドがスマホ幅では崩れるため、スマホ・タブレット
// どちらでも使えるよう別コンポーネントとして新規作成した (order-screen.tsx / レジ画面本体は
// 一切変更していないので、既存のレジ運用への影響は無い)。
// スコープは「卓選択〜注文入力 (厨房送信) まで」(2026-08-31 Tom確認済み)。急遽の値引きや
// 会計・レシート発行はレジ (本体) 側でのみ行う想定のため、ここには含めない。

function groupLabel(m: MenuItem): string | null {
  if (m.middleCategory) return m.middleCategory;
  if (m.minorCategory !== m.category) return m.minorCategory;
  return null;
}

function groupItemsByMiddle(items: MenuItem[]): { label: string | null; items: MenuItem[] }[] {
  const order: (string | null)[] = [];
  const map = new Map<string | null, MenuItem[]>();
  for (const m of items) {
    const label = groupLabel(m);
    if (!map.has(label)) {
      order.push(label);
      map.set(label, []);
    }
    map.get(label)!.push(m);
  }
  order.sort((a, b) => (a === null ? -1 : b === null ? 1 : 0));
  return order.map((label) => ({ label, items: map.get(label)! }));
}

function HeaderTimers({ session }: { session: TableSessionRecord | null }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!session) return;
    const id = setInterval(() => tick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [session]);

  if (!session) return null;
  const stay = formatDuration(elapsedMinutes(session.started_at));
  const drink = drinkTimerState(session.drink_timer_started_at, session.drink_timer_minutes);

  return (
    <div className="flex items-center gap-1.5">
      <span className="rounded-full bg-secondary px-2 py-0.5 text-[10.5px] font-semibold text-muted-foreground">
        滞在{stay}
      </span>
      {drink && (
        <span
          className={
            'rounded-full px-2 py-0.5 text-[10.5px] font-semibold ' +
            (drink.isExpired
              ? 'animate-pulse bg-destructive text-destructive-foreground'
              : drink.isNearExpiry
                ? 'bg-amber-200 text-amber-900'
                : 'bg-emerald-100 text-emerald-800')
          }
        >
          🍺{drink.isExpired ? `終了(${formatDuration(-drink.remainingMinutes)}超過)` : `残り${formatDuration(drink.remainingMinutes)}`}
        </span>
      )}
    </div>
  );
}

function CartRow({ line, onInc, onDec }: { line: CartLine; onInc: (id: string) => void; onDec: (id: string) => void }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold">{line.name}</div>
        <div className="text-xs text-muted-foreground">${money(line.unitPrice)}</div>
      </div>
      <div className="flex flex-shrink-0 items-center gap-1.5">
        <button onClick={() => onDec(line.id)} className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-base">
          −
        </button>
        <div className="w-5 text-center text-[13px] font-semibold">{line.qty}</div>
        <button onClick={() => onInc(line.id)} className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-base">
          ＋
        </button>
      </div>
    </div>
  );
}

function ConfirmedRow({
  item,
  onInc,
  onDec,
  onRemove,
}: {
  item: OrderItemRecord;
  onInc: (itemId: string) => Promise<void>;
  onDec: (itemId: string) => Promise<void>;
  onRemove: (itemId: string) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  async function run(fn: () => Promise<void>) {
    setSaving(true);
    try {
      await fn();
    } catch {
      /* エラーは呼び出し元 (handy-app.tsx) 側の共通処理に任せず、ここでは静かに諦める。
         再送信すれば良いだけの操作なので、専用のエラー表示は持たせず shakeでなく単純に保存中表示のみ。 */
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-border bg-card/60 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] font-semibold text-muted-foreground">{item.menu_name}</div>
        <div className="text-xs text-muted-foreground">${money(item.line_total)}</div>
      </div>
      <div className="flex flex-shrink-0 items-center gap-1.5">
        <button
          onClick={() => run(() => onDec(item.id))}
          disabled={saving || item.qty <= 1}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-base disabled:opacity-40"
        >
          −
        </button>
        <div className="w-5 text-center text-[13px] font-semibold">{item.qty}</div>
        <button
          onClick={() => run(() => onInc(item.id))}
          disabled={saving}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-base disabled:opacity-50"
        >
          ＋
        </button>
        <button
          onClick={() => {
            if (!window.confirm(`「${item.menu_name}」を削除しますか？(厨房へ送信済みの品目です)`)) return;
            run(() => onRemove(item.id));
          }}
          disabled={saving}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-destructive disabled:opacity-50"
        >
          🗑
        </button>
      </div>
    </div>
  );
}

export function HandyOrderScreen({
  selectedTable,
  session,
  happyHourActive,
  menu,
  categories,
  activeCategory,
  onCategory,
  cart,
  confirmedItems,
  onAddItem,
  onInc,
  onDec,
  onIncConfirmedItem,
  onDecConfirmedItem,
  onRemoveConfirmedItem,
  onConfirmOrder,
  confirming,
  confirmError,
  subtotal,
  vat,
  service,
  vatRate,
  serviceRate,
  vatInclusive,
  total,
  menuImageStyle,
  onBackToTableList,
  onResetTable,
  guestMode,
}: {
  selectedTable: string | null;
  session: TableSessionRecord | null;
  happyHourActive: boolean;
  menu: MenuItem[];
  categories: string[];
  activeCategory: string;
  onCategory: (c: string) => void;
  cart: CartLine[];
  confirmedItems: OrderItemRecord[];
  onAddItem: (item: MenuItem) => void;
  onInc: (lineId: string) => void;
  onDec: (lineId: string) => void;
  onIncConfirmedItem: (itemId: string) => Promise<void>;
  onDecConfirmedItem: (itemId: string) => Promise<void>;
  onRemoveConfirmedItem: (itemId: string) => Promise<void>;
  onConfirmOrder: () => void;
  confirming: boolean;
  confirmError: string | null;
  subtotal: number;
  vat: number;
  service: number;
  vatRate: number;
  serviceRate: number;
  vatInclusive: boolean;
  total: number;
  menuImageStyle?: MenuImageStyle;
  onBackToTableList: () => void;
  onResetTable: () => void;
  /** true = QRセルフオーダー (認証なしのお客様向け画面) からの利用。2026-08-31 追加。
   * 「卓をリセット」(取消不能・伝票を破棄する) と「卓一覧へ戻る」(スタッフのハンディ専用の
   * 導線) はスタッフ専用の操作のため、お客様には一切見せない。 */
  guestMode?: boolean;
}) {
  const [cartOpen, setCartOpen] = useState(false);
  const items = menu.filter((m) => m.category === activeCategory);
  const groups = groupItemsByMiddle(items);
  const cartCount = cart.reduce((a, l) => a + l.qty, 0) + confirmedItems.reduce((a, it) => a + it.qty, 0);
  const imageFull = menuImageStyle === 'full';

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3.5 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          {!guestMode && (
            <button onClick={onBackToTableList} className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-border bg-card">
              ←
            </button>
          )}
          <div className="min-w-0">
            <div className="truncate text-[15px] font-bold">テーブル {selectedTable}</div>
            <HeaderTimers session={session} />
          </div>
        </div>
        {!guestMode && (
          <button
            onClick={onResetTable}
            title="会計せずにこの卓を空席へ戻す (間違えて選択・注文した場合)"
            className="flex-shrink-0 rounded-lg border border-destructive/40 px-2 py-1.5 text-[11px] font-medium text-destructive"
          >
            卓をリセット
          </button>
        )}
      </div>

      <div className="flex flex-shrink-0 gap-1.5 overflow-x-auto px-3.5 pb-2 pt-3">
        {categories.map((c) => (
          <button
            key={c}
            onClick={() => onCategory(c)}
            className={
              'h-9 flex-shrink-0 whitespace-nowrap rounded-lg border px-3.5 text-[13px] font-semibold ' +
              (activeCategory === c ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-foreground')
            }
          >
            {c}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-3.5 pb-24">
        {groups.map((g, gi) => (
          <div key={g.label ?? `_flat_${gi}`} className={gi > 0 ? 'mt-4' : ''}>
            {g.label && <div className="mb-2 text-[12px] font-bold text-muted-foreground">{g.label}</div>}
            <div className={'grid auto-rows-min gap-2.5 ' + (imageFull ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4')}>
              {g.items.map((m) => {
                const hasOptions = !!(m.optionGroups && m.optionGroups.length);
                const isHappyHourItem = happyHourActive && typeof m.happyHourPrice === 'number';
                const basePrice = effectiveBasePrice(m, happyHourActive);
                let priceLabel = money(basePrice);
                if (hasOptions) {
                  const minDelta = m.optionGroups!.reduce((s, gr) => s + Math.min(...gr.choices.map((c) => c.priceDelta)), 0);
                  const maxDelta = m.optionGroups!.reduce((s, gr) => s + Math.max(...gr.choices.map((c) => c.priceDelta)), 0);
                  priceLabel = minDelta === maxDelta ? money(basePrice + minDelta) : `${money(basePrice + minDelta)}〜${money(basePrice + maxDelta)}`;
                }
                return (
                  <button
                    key={m.id}
                    onClick={() => onAddItem(m)}
                    className={
                      'flex flex-col gap-3 rounded-xl border p-2.5 text-left ' +
                      (isHappyHourItem ? 'border-amber-300 bg-amber-50' : 'border-border bg-card')
                    }
                  >
                    <div
                      className={
                        'flex items-center justify-center overflow-hidden rounded-lg bg-secondary text-muted-foreground ' +
                        (imageFull ? 'h-24' : 'h-12')
                      }
                    >
                      {m.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.imageUrl} alt="" className={'h-full w-full ' + (imageFull ? 'object-contain' : 'object-cover')} />
                      ) : (
                        '🍽'
                      )}
                    </div>
                    <div>
                      <div className="text-[12.5px] font-semibold leading-tight">{m.name}</div>
                      <div className="mt-0.5 flex items-center justify-between">
                        <span className="text-[12.5px] font-bold text-brand">${priceLabel}</span>
                        {hasOptions && <span className="text-[9.5px] text-muted-foreground">選択あり</span>}
                      </div>
                      {isHappyHourItem && <div className="text-[9.5px] font-semibold text-amber-700">🍻 ハッピーアワー</div>}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* 下部固定バー: カート内容を確認するための入口。常時表示にして、確定済み品目だけの
          卓でも中身を見返せるようにする (2026-08-31)。 */}
      <button
        onClick={() => setCartOpen(true)}
        className="absolute inset-x-3 bottom-3 flex h-14 items-center justify-between rounded-2xl bg-brand px-4 text-brand-foreground shadow-lg"
      >
        <span className="text-[13.5px] font-bold">🛒 カート ({cartCount})</span>
        <span className="text-[15px] font-bold">${money(total)}</span>
      </button>

      {cartOpen && (
        <div className="absolute inset-0 z-50 flex flex-col justify-end bg-slate-900/45" onClick={() => setCartOpen(false)}>
          <div
            className="flex max-h-[85vh] flex-col gap-3 rounded-t-2xl bg-card p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="text-[15px] font-bold">テーブル {selectedTable} の注文</div>
              <button onClick={() => setCartOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary">
                ×
              </button>
            </div>

            <div className="flex flex-1 flex-col gap-3 overflow-auto">
              {confirmedItems.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <div className="text-[11px] font-bold text-muted-foreground">注文済み (厨房送信済み)</div>
                  {confirmedItems.map((it) => (
                    <ConfirmedRow key={it.id} item={it} onInc={onIncConfirmedItem} onDec={onDecConfirmedItem} onRemove={onRemoveConfirmedItem} />
                  ))}
                </div>
              )}
              {cart.length === 0 && confirmedItems.length === 0 && (
                <div className="py-6 text-center text-[13px] text-muted-foreground">メニューをタップして追加してください</div>
              )}
              {cart.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  {confirmedItems.length > 0 && <div className="text-[11px] font-bold text-muted-foreground">未確定</div>}
                  {cart.map((line) => (
                    <CartRow key={line.id} line={line} onInc={onInc} onDec={onDec} />
                  ))}
                </div>
              )}
            </div>

            {confirmError && <div className="text-[11px] text-destructive">{confirmError}</div>}

            <div className="flex flex-col gap-1 border-t border-border pt-2.5 text-[12px] text-muted-foreground">
              <div className="flex justify-between">
                <span>小計</span>
                <span>${money(subtotal)}</span>
              </div>
              {vatRate > 0 && (
                <div className="flex justify-between">
                  <span>VAT {vatRate}%{vatInclusive ? ' (税込み)' : ''}</span>
                  <span>${money(vat)}</span>
                </div>
              )}
              {serviceRate > 0 && (
                <div className="flex justify-between">
                  <span>サービス料 {serviceRate}%</span>
                  <span>${money(service)}</span>
                </div>
              )}
              <div className="mt-0.5 flex justify-between text-[15px] font-bold text-foreground">
                <span>合計</span>
                <span>${money(total)}</span>
              </div>
            </div>

            {cart.length > 0 && (
              <button
                onClick={onConfirmOrder}
                disabled={confirming}
                className="h-12 rounded-lg bg-brand text-[14px] font-bold text-brand-foreground disabled:opacity-60"
              >
                {confirming ? '送信中…' : `注文確定 (${cart.reduce((a, l) => a + l.qty, 0)}点を厨房へ送信)`}
              </button>
            )}
            <div className="text-center text-[10.5px] text-muted-foreground">
              会計はレジで行ってください (ハンディからは会計できません)
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
