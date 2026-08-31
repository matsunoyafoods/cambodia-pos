'use client';

import type { MenuItem, OptionGroup } from '@/lib/pos-types';
import { money } from '@/lib/money';

export type ModalSelection = Record<string, string | undefined>; // groupKey -> choiceId

export function OptionModal({
  item,
  selection,
  onSelect,
  onClose,
  onConfirm,
}: {
  item: MenuItem;
  selection: ModalSelection;
  onSelect: (groupKey: string, choiceId: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const groups: OptionGroup[] = item.optionGroups ?? [];
  const allSelected = groups.every((g) => selection[g.key]);
  const priceDeltaTotal = groups.reduce((sum, g) => {
    const choice = g.choices.find((c) => c.id === selection[g.key]);
    return sum + (choice ? choice.priceDelta : 0);
  }, 0);

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-slate-900/45"
      onClick={onClose}
    >
      <div
        className="flex max-h-[640px] w-[420px] flex-col gap-4 rounded-2xl bg-card p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="text-base font-bold">{item.name}</div>
          <button
            onClick={onClose}
            className="flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-secondary"
            aria-label="閉じる"
          >
            ×
          </button>
        </div>

        <div className="flex flex-col gap-4 overflow-auto">
          {groups.map((g) => (
            <div key={g.key}>
              <div className="mb-2 text-xs font-semibold text-muted-foreground">{g.label}</div>
              <div className="flex flex-wrap gap-2">
                {g.choices.map((c) => {
                  const isSel = selection[g.key] === c.id;
                  return (
                    <button
                      key={c.id}
                      onClick={() => onSelect(g.key, c.id)}
                      className={
                        'flex h-[52px] min-w-[84px] flex-col items-center justify-center rounded-lg border-[1.5px] px-4 text-sm font-semibold ' +
                        (isSel
                          ? 'border-brand bg-brand text-brand-foreground'
                          : 'border-border bg-card text-foreground')
                      }
                    >
                      <div className="font-bold">{c.label}</div>
                      <div className="mt-0.5 text-[11px] opacity-85">
                        {c.priceDelta > 0
                          ? `+$${money(c.priceDelta)}`
                          : c.priceDelta < 0
                            ? `-$${money(Math.abs(c.priceDelta))}`
                            : '$0'}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between border-t border-dashed border-border pt-2">
          <div className="text-sm text-muted-foreground">価格</div>
          <div className="text-lg font-bold">${money(item.price + priceDeltaTotal)}</div>
        </div>

        <button
          onClick={onConfirm}
          disabled={!allSelected}
          className={
            'h-12 rounded-lg text-sm font-bold ' +
            (allSelected ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground')
          }
        >
          カートに追加
        </button>
      </div>
    </div>
  );
}
