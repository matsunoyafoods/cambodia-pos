import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';
import type { ExpenseRecord } from '@/lib/pos-types';

type RouteContext = { params: Promise<{ id: string }> };

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

const patchSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  amountUsd: z.number().positive().optional(),
  category: z.string().trim().min(1).max(60).optional(),
  vendor: z.string().trim().max(60).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
  // 買掛の精算: 'paid' に変更すると paidAt を自動で今日時刻にする (下記参照)。
  paymentStatus: z.enum(['paid', 'unpaid']).optional(),
  // 支払い元 (2026-09-02 追加)。買掛を精算する時 (paymentStatus を 'paid' にする時) に
  // 一緒に渡すことを想定 — その時点で初めて現金が動くため。
  paidFrom: z.enum(['register_cash', 'other']).optional(),
});

// 編集・買掛の精算 ('paid' に変更)。manager 以上のみ。
export const PATCH = withPosStaff('manager', async (_session, req, ctx: RouteContext) => {
  const { id } = await ctx.params;
  const json = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (d.date !== undefined) patch.date = d.date;
  if (d.amountUsd !== undefined) patch.amount_usd = d.amountUsd;
  if (d.category !== undefined) patch.category = d.category;
  if (d.vendor !== undefined) patch.vendor = d.vendor;
  if (d.note !== undefined) patch.note = d.note;
  if (d.paymentStatus !== undefined) {
    patch.payment_status = d.paymentStatus;
    patch.paid_at = d.paymentStatus === 'paid' ? new Date().toISOString() : null;
  }
  if (d.paidFrom !== undefined) patch.paid_from = d.paidFrom;

  const { data, error } = await supabase
    .from('expenses')
    .update(patch)
    .eq('id', id)
    .eq('store_id', storeId)
    .select(selectCols)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ expense: toRecord(data) });
});

// 削除。manager 以上のみ (入力ミスの取り消し用)。
export const DELETE = withPosStaff('manager', async (_session, _req, ctx: RouteContext) => {
  const { id } = await ctx.params;
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();
  const { error } = await supabase.from('expenses').delete().eq('id', id).eq('store_id', storeId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
});
