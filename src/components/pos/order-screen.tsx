'use client';

import { useEffect, useState } from 'react';
import type { CartLine, MenuItem } from '@/lib/pos-types';
import { money } from '@/lib/money';
import type { TableSessionRecord } from '@/lib/table-session-client';
import { drinkTimerState, elapsedMinutes, formatDuration } from '@/lib/table-timer';
import { effectiveBasePrice } from '@/lib/happy-hour';

function OrderHeaderTimers({ session }: { session: TableSessionRecord | null }) {
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
    <div className="flex items-center gap-2">
      <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
        滞在 {stay}
      </span>
      {drink && (
        <span
          className={
            'rounded-full px-2.5 py-1 text-[11px] font-semibold ' +
            (drink.isExpired
              ? 'animate-pulse bg-destructive text-destructive-foreground'
              : drink.isNearExpiry
                ? 'bg-amber-200 text-amber-900'
                : 'bg-emerald-100 text-emerald-800')
          }
        >
          🍺 {drink.isExpired ? `延長してください (${formatDuration(-drink.remainingMinutes)}超過)` : `残り${formatDuration(drink.remainingMinutes)}`}
        </span>
      )}
    </div>
  );
}

export function OrderScreen({
  selectedTable,
  session,
  happyHourActive,
  menu,
  categories,
  activeCategory,
  onCategory,
  cart,
  onAddItem,
  onInc,
  onDec,
  subtotal,
  taxService,
  vatRate,
  serviceRate,
  total,
  onBackToTableMap,
  onCheckout,
}: {
  selectedTable: string | null;
  session: TableSessionRecord | null;
  happyHourActive: boolean;
  menu: MenuItem[];
  categories: string[];
  activeCategory: string;
  onCategory: (c: string) => void;
  cart: CartLine[];
  onAddItem: (item: MenuItem) => void;
  onInc: (lineId: string) => void;
  onDec: (lineId: string) => void;
  subtotal: number;
  taxService: number;
  vatRate: number;
  serviceRate: number;
  total: number;
  onBackToTableMap: () => void;
  onCheckout: () => void;
}) {
  const items = menu.filter((m) => m.category === activeCategory);
  const cartCount = cart.reduce((a, l) => a + l.qty, 0);

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-2.5 border-b border-border px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <button
              onClick={onBackToTableMap}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card"
            >
              ←
            </button>
            <div>
              <div className="text-base font-bold">テーブル {selectedTable}</div>
              <div className="text-xs text-muted-foreground">注文入力</div>
            </div>
          </div>
          <OrderHeaderTimers session={session} />
        </div>

        <div className="flex gap-1.5 px-5 pt-3.5">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => onCategory(c)}
              className={
                'h-[34px] rounded-lg border px-4 text-sm font-semibold ' +
                (activeCategory === c
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card text-foreground')
              }
            >
              {c}
            </button>
          ))}
        </div>

        <div className="grid flex-1 auto-rows-min grid-cols-3 gap-3 overflow-auto p-5">
          {items.map((m) => {
            const hasOptions = !!(m.optionGroups && m.optionGroups.length);
            const isHappyHourItem = happyHourActive && typeof m.happyHourPrice === 'number';
            const basePrice = effectiveBasePrice(m, happyHourActive);
            let priceLabel = money(basePrice);
            if (hasOptions) {
              const minDelta = m.optionGroups!.reduce(
                (s, g) => s + Math.min(...g.choices.map((c) => c.priceDelta)),
                0,
              );
              const maxDelta = m.optionGroups!.reduce(
                (s, g) => s + Math.max(...g.choices.map((c) => c.priceDelta)),
                0,
              );
              priceLabel =
                minDelta === maxDelta
                  ? money(basePrice + minDelta)
                  : `${money(basePrice + minDelta)}〜${money(basePrice + maxDelta)}`;
            }
            return (
              <button
                key={m.id}
                onClick={() => onAddItem(m)}
                className={
                  'flex flex-col gap-6 rounded-xl border p-3.5 text-left ' +
                  (isHappyHourItem ? 'border-amber-300 bg-amber-50' : 'border-border bg-card')
                }
              >
                <div className="flex h-16 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
                  🍽
                </div>
                <div>
                  <div className="flex items-end justify-between">
                    <div className="text-[13.5px] font-semibold leading-tight">{m.name}</div>
                    <div className="ml-2 whitespace-nowrap text-[13.5px] font-bold text-brand">
                      ${priceLabel}
                    </div>
                  </div>
                  {hasOptions && <div className="text-[10px] text-muted-foreground">オプションあり</div>}
                  {isHappyHourItem && (
                    <div className="text-[10px] font-semibold text-amber-700">🍻 ハッピーアワー価格</div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex w-[340px] flex-col border-l border-border bg-secondary/40">
        <div className="px-4.5 pb-2.5 pt-4 text-sm font-bold">カート ({cartCount})</div>
        <div className="flex flex-1 flex-col gap-2.5 overflow-auto px-4.5">
          {cart.length === 0 && (
            <div className="py-5 text-center text-[13px] text-muted-foreground">
              メニューをタップして追加してください
            </div>
          )}
          {cart.map((line) => (
            <div
              key={line.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold">{line.name}</div>
                <div className="text-xs text-muted-foreground">${money(line.unitPrice)}</div>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => onDec(line.id)}
                  className="flex h-[26px] w-[26px] items-center justify-center rounded-md border border-border"
                >
                  −
                </button>
                <div className="w-[18px] text-center text-[13px] font-semibold">{line.qty}</div>
                <button
                  onClick={() => onInc(line.id)}
                  className="flex h-[26px] w-[26px] items-center justify-center rounded-md border border-border"
                >
                  ＋
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-1.5 border-t border-border px-4.5 py-3.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>小計</span>
            <span>${money(subtotal)}</span>
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>VAT {vatRate}% + サービス料 {serviceRate}%</span>
            <span>${money(taxService)}</span>
          </div>
          <div className="mt-1 flex justify-between text-[15px] font-bold">
            <span>合計</span>
            <span>${money(total)}</span>
          </div>
          <div className="mt-0.5 text-[10.5px] text-muted-foreground">
            確定時に厨房プリンターへ自動送信されます
          </div>
          <button
            onClick={onCheckout}
            disabled={cart.length === 0}
            className={
              'mt-2 h-[50px] rounded-lg text-[14.5px] font-bold ' +
              (cart.length === 0 ? 'bg-secondary text-muted-foreground' : 'bg-brand text-brand-foreground')
            }
          >
            会計へ進む
          </button>
        </div>
      </div>
    </div>
  );
}
