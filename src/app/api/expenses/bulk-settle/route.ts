import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';
import type { ExpenseRecord } from '@/lib/pos-types';

// 買掛のまとめ精算 (2026-10-24 追加)。
// Tom「業者別でわかるようにしてください。そして支払いをしたらまとめて完了できるようにして
// ください」への対応。/pos/expenses の「買掛サマリ (仕入れ先別)」カードから、ある仕入れ先への
// 未払い分を1回の支払いでまとめて精算した時に、対象の経費記録を一括で 'paid' にする。
// 単体精算 (PATCH /api/expenses/[id]) と同じルール: manager 以上のみ、精算時に paidAt を
// 自動設定し、paidFrom (レジ現金 / その他) を一括で確定する。

const selectCols =
  'id, date, amount_usd, category, vendor, note, payment_status, paid_at, paid_from, receipt_image_url, created_by, created_at';

function toRecord(row: {
  id: string;
  date: string;
  amount_usd: number;
  category: string;
  vendor: string | null;
  note: string | null;
  payment_status: 'paid' | 'unpaid';
  paid_at: string | null;
  paid_from: 'register_cash' | 'other';
  receipt_image_url: string | null;
  created_by: string | null;
  created_at: string;
}): ExpenseRecord {
  return {
    id: row.id,
    date: row.date,
    amountUsd: row.amount_usd,
    category: row.category,
    vendor: row.vendor,
    note: row.note,
    paymentStatus: row.payment_status,
    paidAt: row.paid_at,
    paidFrom: row.paid_from,
    receiptImageUrl: row.receipt_image_url,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

const postSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
  paidFrom: z.enum(['register_cash', 'other']),
});

// まとめ精算。manager 以上のみ (単体精算と同じ権限)。
// 既に 'paid' になっている行・他店舗の行は対象に含めない (念のための防御。通常は画面側で
// 未払い分の id のみを渡すため発生しないはずだが、二重送信や別タブでの操作ずれに備える)。
export const POST = withPosStaff('manager', async (_session, req) => {
  const json = await req.json().catch(() => null);
  const parsed = postSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }
  const { ids, paidFrom } = parsed.data;
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data, error } = await supabase
    .from('expenses')
    .update({
      payment_status: 'paid',
      paid_at: new Date().toISOString(),
      paid_from: paidFrom,
      updated_at: new Date().toISOString(),
    })
    .eq('store_id', storeId)
    .eq('payment_status', 'unpaid')
    .in('id', ids)
    .select(selectCols);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const settled = (data ?? []).map(toRecord);
  return NextResponse.json({ settledCount: settled.length, settled });
});
