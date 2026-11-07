import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';

// 現金残高 (2026-09-02 追加)。
// 現金残高 = 起点の残高 + Σ(確定したレジ締めの現金売上) − Σ(銀行入金) − Σ(レジの現金で払った経費、支払い済みのみ)
// 常に元データから計算する (途中経過を別カラムに保存して食い違わせない方針。insights等と同じ考え方)。
// manager 以上のみ (店舗の資金状況が見える情報のため、経費レポートと同じ)。
//
// 起点 (2026-11-07 追加): 「紙レシートでもらう」経由の現金がレジ締めに反映されていなかった期間
// (2026-10-08〜11-06) があり、過去分は遡って直さないことにした (Tom 判断)。そこで
// pos.stores.settings.cashBalanceBaseline = { asOfDate, amountUsd } に「asOfDate の営業終了時点で
// 実際に数えた現金 (レジ金を除く)」を持ち、asOfDate より後の日付のデータだけを積み上げる。
// 起点が無い店舗は従来通り全期間を合計する (起点 = 0)。

type CashBalanceBaseline = {
  asOfDate: string;
  amountUsd: number;
  note?: string | null;
  setByName?: string | null;
  setAt?: string;
};

function readBaseline(settings: unknown): CashBalanceBaseline | null {
  const raw = (settings as { cashBalanceBaseline?: unknown } | null)?.cashBalanceBaseline as
    | Partial<CashBalanceBaseline>
    | undefined;
  if (!raw || typeof raw.asOfDate !== 'string' || typeof raw.amountUsd !== 'number') return null;
  return {
    asOfDate: raw.asOfDate,
    amountUsd: raw.amountUsd,
    note: raw.note ?? null,
    setByName: raw.setByName ?? null,
    setAt: raw.setAt,
  };
}

export const GET = withPosStaff('manager', async () => {
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data: store, error: storeError } = await supabase.from('stores').select('settings').eq('id', storeId).maybeSingle();
  if (storeError) return NextResponse.json({ error: storeError.message }, { status: 500 });
  const baseline = readBaseline(store?.settings);

  let closingsQuery = supabase.from('register_closings').select('system_cash_total, date').eq('store_id', storeId);
  let depositsQuery = supabase.from('cash_deposits').select('amount_usd').eq('store_id', storeId);
  let expensesQuery = supabase
    .from('expenses')
    .select('amount_usd')
    .eq('store_id', storeId)
    .eq('paid_from', 'register_cash')
    .eq('payment_status', 'paid');
  if (baseline) {
    closingsQuery = closingsQuery.gt('date', baseline.asOfDate);
    depositsQuery = depositsQuery.gt('date', baseline.asOfDate);
    expensesQuery = expensesQuery.gt('date', baseline.asOfDate);
  }

  const [closingsRes, depositsRes, expensesRes, lastClosingRes] = await Promise.all([
    closingsQuery,
    depositsQuery,
    expensesQuery,
    supabase.from('register_closings').select('date').eq('store_id', storeId).order('date', { ascending: false }).limit(1).maybeSingle(),
  ]);

  if (closingsRes.error) return NextResponse.json({ error: closingsRes.error.message }, { status: 500 });
  if (depositsRes.error) return NextResponse.json({ error: depositsRes.error.message }, { status: 500 });
  if (expensesRes.error) return NextResponse.json({ error: expensesRes.error.message }, { status: 500 });

  const baselineUsd = baseline?.amountUsd ?? 0;
  const cashSalesTotal = (closingsRes.data ?? []).reduce((sum, r) => sum + Number(r.system_cash_total), 0);
  const bankDepositsTotal = (depositsRes.data ?? []).reduce((sum, r) => sum + Number(r.amount_usd), 0);
  const cashExpensesTotal = (expensesRes.data ?? []).reduce((sum, r) => sum + Number(r.amount_usd), 0);
  const lastClosingDate = (lastClosingRes.data?.date as string | undefined) ?? null;

  return NextResponse.json({
    cashSalesTotal,
    bankDepositsTotal,
    cashExpensesTotal,
    balance: Math.round((baselineUsd + cashSalesTotal - bankDepositsTotal - cashExpensesTotal) * 100) / 100,
    lastClosingDate,
    baseline,
  });
});

const baselineSchema = z.object({
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amountUsd: z.number().min(0),
  note: z.string().trim().max(500).optional(),
});

// 起点の設定 (実査した現金でシステム上の残高をリセットする)。owner/manager のみ。
export const PUT = withPosStaff('manager', async (session, req) => {
  const json = await req.json().catch(() => null);
  const parsed = baselineSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();
  const { data: existing, error: readError } = await supabase.from('stores').select('settings').eq('id', storeId).maybeSingle();
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });

  const current = (existing?.settings && typeof existing.settings === 'object' ? existing.settings : {}) as Record<string, unknown>;
  const baseline: CashBalanceBaseline = {
    asOfDate: parsed.data.asOfDate,
    amountUsd: parsed.data.amountUsd,
    note: parsed.data.note ?? null,
    setByName: session.displayName,
    setAt: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('stores')
    .update({ settings: { ...current, cashBalanceBaseline: baseline }, updated_at: new Date().toISOString() })
    .eq('id', storeId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ baseline });
});
