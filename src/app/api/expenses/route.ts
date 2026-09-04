import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';
import type { ExpenseRecord } from '@/lib/pos-types';

// 経費の記録 (2026-08-31 追加。データ収集・AI分析機能 第一弾)。
// 一覧・集計は manager 以上限定 (店舗の支出状況が見えるため)。登録は staff でも可
// (「よく買うところ」等で実際に立て替え購入したスタッフが、その場で記録できるように)。

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

const RECEIPT_BUCKET = 'expense-receipts';

// receipt_image_url には Storage 上のパス (storeId/expenseId.ext) を保存している (非公開バケット)。
// 一覧表示のたびに、写真が付いている行だけまとめて signed URL に差し替える。
async function withSignedReceiptUrls(supabase: ReturnType<typeof createPosAdminClient>, records: ExpenseRecord[]): Promise<ExpenseRecord[]> {
  const paths = records.map((r) => r.receiptImageUrl).filter((p): p is string => !!p);
  if (paths.length === 0) return records;
  const { data, error } = await supabase.storage.from(RECEIPT_BUCKET).createSignedUrls(paths, 3600);
  if (error || !data) return records.map((r) => ({ ...r, receiptImageUrl: null }));
  const urlByPath = new Map(data.map((d) => [d.path, d.signedUrl]));
  return records.map((r) => (r.receiptImageUrl ? { ...r, receiptImageUrl: urlByPath.get(r.receiptImageUrl) ?? null } : r));
}

// 一覧 (期間・支払い状況で絞り込み可)。manager 以上のみ。
export const GET = withPosStaff('manager', async (_session, req) => {
  const url = new URL(req.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const status = url.searchParams.get('status');

  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();
  let query = supabase.from('expenses').select(selectCols).eq('store_id', storeId).order('date', { ascending: false }).order('created_at', { ascending: false });
  if (from) query = query.gte('date', from);
  if (to) query = query.lte('date', to);
  if (status === 'paid' || status === 'unpaid') query = query.eq('payment_status', status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const records = await withSignedReceiptUrls(supabase, (data ?? []).map(toRecord));
  return NextResponse.json({ expenses: records });
});

const postSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日付は YYYY-MM-DD 形式で入力してください'),
  amountUsd: z.number().positive(),
  category: z.string().trim().min(1).max(60),
  vendor: z.string().trim().max(60).optional(),
  note: z.string().trim().max(500).optional(),
  paymentStatus: z.enum(['paid', 'unpaid']).default('paid'),
  // 支払い元 (2026-09-02 追加)。'unpaid' の場合は無視される (まだ現金が動いていないため)。
  paidFrom: z.enum(['register_cash', 'other']).default('other'),
});

// 新規登録。staff 以上 (誰でも記録できる)。
export const POST = withPosStaff('part_time', async (session, req) => {
  const json = await req.json().catch(() => null);
  const parsed = postSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data, error } = await supabase
    .from('expenses')
    .insert({
      store_id: storeId,
      date: d.date,
      amount_usd: d.amountUsd,
      category: d.category,
      vendor: d.vendor || null,
      note: d.note || null,
      payment_status: d.paymentStatus,
      paid_at: d.paymentStatus === 'paid' ? new Date().toISOString() : null,
      paid_from: d.paidFrom,
      created_by: session.staffId,
    })
    .select(selectCols)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ expense: toRecord(data) }, { status: 201 });
});
