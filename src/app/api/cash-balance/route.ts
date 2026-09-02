import { NextResponse } from 'next/server';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';

// 現金残高 (2026-09-02 追加)。
// 現金残高 = Σ(確定したレジ締めの現金売上) − Σ(銀行入金) − Σ(レジの現金で払った経費、支払い済みのみ)
// 常に元データから計算する (途中経過を別カラムに保存して食い違わせない方針。insights等と同じ考え方)。
// manager 以上のみ (店舗の資金状況が見える情報のため、経費レポートと同じ)。
export const GET = withPosStaff('manager', async () => {
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const [closingsRes, depositsRes, expensesRes] = await Promise.all([
    supabase.from('register_closings').select('system_cash_total, date').eq('store_id', storeId),
    supabase.from('cash_deposits').select('amount_usd').eq('store_id', storeId),
    supabase.from('expenses').select('amount_usd').eq('store_id', storeId).eq('paid_from', 'register_cash').eq('payment_status', 'paid'),
  ]);

  if (closingsRes.error) return NextResponse.json({ error: closingsRes.error.message }, { status: 500 });
  if (depositsRes.error) return NextResponse.json({ error: depositsRes.error.message }, { status: 500 });
  if (expensesRes.error) return NextResponse.json({ error: expensesRes.error.message }, { status: 500 });

  const cashSalesTotal = (closingsRes.data ?? []).reduce((sum, r) => sum + Number(r.system_cash_total), 0);
  const bankDepositsTotal = (depositsRes.data ?? []).reduce((sum, r) => sum + Number(r.amount_usd), 0);
  const cashExpensesTotal = (expensesRes.data ?? []).reduce((sum, r) => sum + Number(r.amount_usd), 0);
  const lastClosingDate = (closingsRes.data ?? []).map((r) => r.date as string).sort().at(-1) ?? null;

  return NextResponse.json({
    cashSalesTotal,
    bankDepositsTotal,
    cashExpensesTotal,
    balance: cashSalesTotal - bankDepositsTotal - cashExpensesTotal,
    lastClosingDate,
  });
});
