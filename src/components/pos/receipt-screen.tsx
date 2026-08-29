'use client';

import { money } from '@/lib/money';

export function ReceiptScreen({
  selectedTable,
  total,
  onNewOrder,
}: {
  selectedTable: string | null;
  total: number;
  onNewOrder: () => void;
}) {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="flex w-[360px] flex-col items-center gap-3.5 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-600">
          ✓
        </div>
        <div className="text-lg font-bold">会計が完了しました</div>
        <div className="text-[13px] text-muted-foreground">
          テーブル {selectedTable} ・ 合計 ${money(total)}
          <br />
          レシートを印刷しています…
        </div>
        <button
          onClick={onNewOrder}
          className="mt-2 h-12 w-full rounded-lg bg-primary text-sm font-semibold text-primary-foreground"
        >
          テーブルマップへ戻る
        </button>
        <button className="h-11 w-full rounded-lg border border-border bg-card text-[13.5px] font-semibold">
          顧客控えを再印刷
        </button>
      </div>
    </div>
  );
}
