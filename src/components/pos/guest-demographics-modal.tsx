'use client';

import { useState } from 'react';
import { ETHNICITY_KEYS, ETHNICITY_LABELS, type GuestEthnicity } from '@/lib/pos-types';

// ファースト注文 (この卓に open 注文がまだ無い状態で最初に商品をタップした時) に必ず挟む
// 客層記録モーダル。人種構成の合計が1人以上でないと保存できない (キャンセルすれば商品は
// カートに追加されず、次にどれかタップすればまた同じモーダルが出る)。
export function GuestDemographicsModal({
  onCancel,
  onConfirm,
  submitting,
  error,
}: {
  onCancel: () => void;
  onConfirm: (ethnicity: GuestEthnicity, kidsCount: number) => void;
  submitting: boolean;
  error: string | null;
}) {
  const [counts, setCounts] = useState<GuestEthnicity>({});
  const [kids, setKids] = useState(0);

  const total = ETHNICITY_KEYS.reduce((s, k) => s + (counts[k] ?? 0), 0);
  const canSubmit = total > 0 && !submitting;

  function inc(key: (typeof ETHNICITY_KEYS)[number], delta: number) {
    setCounts((prev) => ({ ...prev, [key]: Math.max(0, (prev[key] ?? 0) + delta) }));
  }

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-900/45">
      <div className="flex max-h-[90vh] w-[440px] max-w-[92vw] flex-col gap-4 rounded-2xl bg-card p-5 shadow-2xl">
        <div>
          <div className="text-base font-bold">来店客の客層を記録してください</div>
          <div className="mt-1 text-[11.5px] text-muted-foreground">
            この卓のファースト注文には、人種構成・子供人数の入力が必須です。
          </div>
        </div>

        <div className="flex flex-col gap-2 overflow-auto">
          {ETHNICITY_KEYS.map((key) => (
            <div key={key} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <div className="text-[13px] font-semibold">{ETHNICITY_LABELS[key]}</div>
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => inc(key, -1)}
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-sm"
                >
                  −
                </button>
                <div className="w-6 text-center text-[13px] font-semibold">{counts[key] ?? 0}</div>
                <button
                  type="button"
                  onClick={() => inc(key, 1)}
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-sm"
                >
                  ＋
                </button>
              </div>
            </div>
          ))}

          <div className="flex items-center justify-between rounded-lg border border-dashed border-border px-3 py-2">
            <div className="text-[13px] font-semibold">子供人数</div>
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => setKids((v) => Math.max(0, v - 1))}
                className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-sm"
              >
                −
              </button>
              <div className="w-6 text-center text-[13px] font-semibold">{kids}</div>
              <button
                type="button"
                onClick={() => setKids((v) => v + 1)}
                className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-sm"
              >
                ＋
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-dashed border-border pt-2 text-[12px] text-muted-foreground">
          <span>合計人数 (子供を除く)</span>
          <span className="font-bold text-foreground">{total}人</span>
        </div>
        {total === 0 && <div className="text-[11px] text-destructive">1人以上を選択してください</div>}
        {error && <div className="text-[11px] text-destructive">{error}</div>}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-11 flex-1 rounded-lg border border-border text-sm font-semibold"
          >
            キャンセル
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => onConfirm(counts, kids)}
            className={
              'h-11 flex-1 rounded-lg text-sm font-bold ' +
              (canSubmit ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground')
            }
          >
            {submitting ? '保存中…' : '保存して注文へ進む'}
          </button>
        </div>
      </div>
    </div>
  );
}
