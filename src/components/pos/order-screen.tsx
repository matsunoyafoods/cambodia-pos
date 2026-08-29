'use client';

import type { CartLine, MenuItem } from '@/lib/pos-types';
import { CATEGORIES, DEMO_MENU } from '@/lib/demo-data';
import { money } from '@/lib/money';

export function OrderScreen({
  selectedTable,
  activeCategory,
  onCategory,
  cart,
  onAddItem,
  onInc,
  onDec,
  subtotal,
  taxService,
  total,
  onBackToTableMap,
  onCheckout,
}: {
  selectedTable: string | null;
  activeCategory: string;
  onCategory: (c: string) => void;
  cart: CartLine[];
  onAddItem: (item: MenuItem) => void;
  onInc: (lineId: string) => void;
  onDec: (lineId: string) => void;
  subtotal: number;
  taxService: number;
  total: number;
  onBackToTableMap: () => void;
  onCheckout: () => void;
}) {
  const items = DEMO_MENU.filter((m) => m.category === activeCategory);
  const cartCount = cart.reduce((a, l) => a + l.qty, 0);

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center gap-2.5 border-b border-border px-5 py-3.5">
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

        <div className="flex gap-1.5 px-5 pt-3.5">
          {CATEGORIES.map((c) => (
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
            let priceLabel = money(m.price);
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
                  ? money(m.price + minDelta)
                  : `${money(m.price + minDelta)}〜${money(m.price + maxDelta)}`;
            }
            return (
              <button
                key={m.id}
                onClick={() => onAddItem(m)}
                className="flex flex-col gap-6 rounded-xl border border-border bg-card p-3.5 text-left"
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
            <span>VAT 10% + サービス料 10%</span>
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
