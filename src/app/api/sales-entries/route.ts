import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';
import type { ManualDailySalesRecord } from '@/lib/pos-types';

// 手入力売上 (2026-09-24 追加)。オーダー・会計機能を一時的に使わない間、
// 「何月何日に現金売上といくら、カード/QR売上がいくらか」を手入力で記録するための機能。
// pos.orders 由来の /api/sales-report とは別データソース (オーダー機能停止中は常に0件になるため)。
// 売上が見える情報のため manager 以上限定・sub_manager は締め出す (/api/sales-report と同じ方針)。

const selectCols =
  'id, date, cash_usd, credit_card_usd, aba_qr_usd, kb_qr_usd, ppcb_qr_usd, delivery_usd, voucher_usd, note, created_by_name, updated_by_name, created_at, updated_at';

type Row = {
  id: string;
  date: string;
  cash_usd: number;
  credit_card_usd: number;
  aba_qr_usd: number;
  kb_qr_usd: number;
  ppcb_qr_usd: number;
  delivery_usd: number;
  voucher_usd: number;
  note: string | null;
  created_by_name: string | null;
  updated_by_name: string | null;
  created_at: string;
  updated_at: string;
};

function toRecord(row: Row): ManualDailySalesRecord {
  return {
    id: row.id,
    date: row.date,
    cashUsd: Number(row.cash_usd),
    creditCardUsd: Number(row.credit_card_usd),
    abaQrUsd: Number(row.aba_qr_usd),
    kbQrUsd: Number(row.kb_qr_usd),
    ppcbQrUsd: Number(row.ppcb_qr_usd),
    deliveryUsd: Number(row.delivery_usd),
    voucherUsd: Number(row.voucher_usd),
    note: row.note,
    createdByName: row.created_by_name,
    updatedByName: row.updated_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const GATE_OPTS = { deny: ['sub_manager' as const] };

// GET /api/sales-entries?month=YYYY-MM : 指定月の一覧+合計
// GET /api/sales-entries?date=YYYY-MM-DD : 指定日の1件 (フォームの再編集用プリフィル)
export const GET = withPosStaff(
  'manager',
  async (_session, req) => {
    const url = new URL(req.url);
    const month = url.searchParams.get('month');
    const date = url.searchParams.get('date');
    const supabase = createPosAdminClient();
    const storeId = getPosStoreId();

    if (date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return NextResponse.json({ error: 'date (YYYY-MM-DD) を指定してください' }, { status: 400 });
      }
      const { data, error } = await supabase.from('manual_daily_sales').select(selectCols).eq('store_id', storeId).eq('date', date).maybeSingle();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ entry: data ? toRecord(data as Row) : null });
    }

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: 'month (YYYY-MM) または date (YYYY-MM-DD) を指定してください' }, { status: 400 });
    }
    const { data, error } = await supabase
      .from('manual_daily_sales')
      .select(selectCols)
      .eq('store_id', storeId)
      .gte('date', `${month}-01`)
      .lt('date', nextMonth(month))
      .order('date', { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const days = (data ?? []).map((r) => toRecord(r as Row));
    const monthTotals = days.reduce(
      (acc, d) => {
        acc.cashUsd += d.cashUsd;
        acc.creditCardUsd += d.creditCardUsd;
        acc.abaQrUsd += d.abaQrUsd;
        acc.kbQrUsd += d.kbQrUsd;
        acc.ppcbQrUsd += d.ppcbQrUsd;
        acc.deliveryUsd += d.deliveryUsd;
        acc.voucherUsd += d.voucherUsd;
        return acc;
      },
      { cashUsd: 0, creditCardUsd: 0, abaQrUsd: 0, kbQrUsd: 0, ppcbQrUsd: 0, deliveryUsd: 0, voucherUsd: 0 },
    );
    const grandTotal = Object.values(monthTotals).reduce((s, v) => s + v, 0);
    return NextResponse.json({ month, days, monthTotals, grandTotal });
  },
  GATE_OPTS,
);

function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

const amountField = z.number().min(0).max(999999).default(0);

const postSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日付は YYYY-MM-DD 形式で入力してください'),
  cashUsd: amountField,
  creditCardUsd: amountField,
  abaQrUsd: amountField,
  kbQrUsd: amountField,
  ppcbQrUsd: amountField,
  deliveryUsd: amountField,
  voucherUsd: amountField,
  note: z.string().trim().max(500).optional(),
});

// 新規登録・上書き保存 (同じ日付なら upsert で更新)。manager 以上限定。
export const POST = withPosStaff(
  'manager',
  async (session, req) => {
    const json = await req.json().catch(() => null);
    const parsed = postSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
    }
    const d = parsed.data;
    const supabase = createPosAdminClient();
    const storeId = getPosStoreId();

    const { data: existing } = await supabase.from('manual_daily_sales').select('id, created_by_name').eq('store_id', storeId).eq('date', d.date).maybeSingle();

    const { data, error } = await supabase
      .from('manual_daily_sales')
      .upsert(
        {
          store_id: storeId,
          date: d.date,
          cash_usd: d.cashUsd,
          credit_card_usd: d.creditCardUsd,
          aba_qr_usd: d.abaQrUsd,
          kb_qr_usd: d.kbQrUsd,
          ppcb_qr_usd: d.ppcbQrUsd,
          delivery_usd: d.deliveryUsd,
          voucher_usd: d.voucherUsd,
          note: d.note || null,
          created_by: existing ? undefined : session.staffId,
          created_by_name: existing ? existing.created_by_name : session.displayName,
          updated_by: session.staffId,
          updated_by_name: session.displayName,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'store_id,date' },
      )
      .select(selectCols)
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ entry: toRecord(data as Row) }, { status: existing ? 200 : 201 });
  },
  GATE_OPTS,
);
