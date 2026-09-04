import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';

// レジ締め (2026-09-02 実データ連携)。
// これまで register-closing-screen.tsx はシステム合計をすべて固定のデモ値で表示するだけで、
// 「レジ締めを確定」ボタンも DB には一切書き込んでいなかった (pos.register_closings は0件のまま)。
// Tom「レジ締めの時の現金売上が貯まるようにして」への対応で、初めて実データと接続する。
//
// 現金残高 (/api/cash-balance) は、ここで確定したレジ締めの system_cash_total を積み上げていく。
// 1日1回のレジ締めを前提にする (store_id, date の unique制約。シフトごとの複数回締めは今回のスコープ外)。

const USD_DENOMS = [100, 50, 20, 10, 5, 1];
const KHR_DENOMS = [100000, 50000, 20000, 10000, 5000, 2000, 1000, 500];

// カンボジアはDST無しの固定 UTC+7。
function dayRangeUtc(date: string): { startIso: string; endIso: string } {
  const startIso = `${date}T00:00:00+07:00`;
  const endIso = new Date(new Date(startIso).getTime() + 24 * 60 * 60 * 1000).toISOString();
  return { startIso, endIso };
}

type SystemTotals = { systemCashTotal: number; systemTotalsByMethod: Record<string, number>; salesTotal: number };

// 指定日の実売上をその場で集計する (pos.orders が status='paid' かつ paid_at がその日のもの)。
// payments.cash_received_usd が非nullなら現金払い (checkout-screen.tsx の addLine 参照)。
async function computeSystemTotals(supabase: ReturnType<typeof createPosAdminClient>, storeId: string, date: string): Promise<SystemTotals> {
  const { startIso, endIso } = dayRangeUtc(date);
  const { data: orders, error: ordersError } = await supabase
    .from('orders')
    .select('id')
    .eq('store_id', storeId)
    .eq('status', 'paid')
    .gte('paid_at', startIso)
    .lt('paid_at', endIso);
  if (ordersError) throw new Error(ordersError.message);

  const orderIds = (orders ?? []).map((o) => o.id as string);
  if (orderIds.length === 0) return { systemCashTotal: 0, systemTotalsByMethod: {}, salesTotal: 0 };

  const { data: payments, error: paymentsError } = await supabase
    .from('payments')
    .select('method, amount, cash_received_usd')
    .in('order_id', orderIds);
  if (paymentsError) throw new Error(paymentsError.message);

  let systemCashTotal = 0;
  let salesTotal = 0;
  const byMethod: Record<string, number> = {};
  for (const p of payments ?? []) {
    const amount = Number(p.amount);
    salesTotal += amount;
    byMethod[p.method as string] = (byMethod[p.method as string] ?? 0) + amount;
    if (p.cash_received_usd !== null) systemCashTotal += amount;
  }
  return { systemCashTotal, systemTotalsByMethod: byMethod, salesTotal };
}

async function getKhrRate(supabase: ReturnType<typeof createPosAdminClient>, storeId: string): Promise<number> {
  const { data } = await supabase.from('stores').select('settings').eq('id', storeId).maybeSingle();
  const stored = data?.settings as { khrRate?: number } | null;
  return typeof stored?.khrRate === 'number' ? stored.khrRate : 4100;
}

type ClosingRow = {
  id: string;
  date: string;
  shift: string | null;
  system_cash_total: number;
  system_totals_by_method: Record<string, number>;
  counted_usd_bills: Record<string, number>;
  counted_khr_bills: Record<string, number>;
  counted_total_usd: number;
  difference_usd: number;
  confirmed_by_name: string | null;
  confirmed_at: string;
};

function toApi(row: ClosingRow) {
  return {
    id: row.id,
    date: row.date,
    shift: row.shift,
    systemCashTotal: Number(row.system_cash_total),
    systemTotalsByMethod: row.system_totals_by_method ?? {},
    countedUsdBills: row.counted_usd_bills ?? {},
    countedKhrBills: row.counted_khr_bills ?? {},
    countedTotalUsd: Number(row.counted_total_usd),
    differenceUsd: Number(row.difference_usd),
    confirmedByName: row.confirmed_by_name,
    confirmedAt: row.confirmed_at,
  };
}

const closingSelectCols =
  'id, date, shift, system_cash_total, system_totals_by_method, counted_usd_bills, counted_khr_bills, counted_total_usd, difference_usd, confirmed_by_name, confirmed_at';

// 指定日のレジ締め状況を取得。既に確定済みならその記録を、未確定ならその場で集計したシステム
// 合計 (未確定・実査待ち) を返す。staff 以上 (締め作業はシフトの担当者が誰でも行えるように)。
export const GET = withPosStaff('part_time', async (_session, req) => {
  const url = new URL(req.url);
  const date = url.searchParams.get('date');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date (YYYY-MM-DD) を指定してください' }, { status: 400 });
  }

  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data: existing, error: existingError } = await supabase
    .from('register_closings')
    .select(closingSelectCols)
    .eq('store_id', storeId)
    .eq('date', date)
    .maybeSingle();
  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });

  if (existing) {
    return NextResponse.json({ confirmed: true, closing: toApi(existing as ClosingRow) });
  }

  try {
    const totals = await computeSystemTotals(supabase, storeId, date);
    return NextResponse.json({ confirmed: false, ...totals });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '集計に失敗しました' }, { status: 500 });
  }
});

const billsSchema = z.record(z.string(), z.number().int().min(0));

const postSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日付は YYYY-MM-DD 形式で入力してください'),
  shift: z.string().trim().max(60).optional(),
  countedUsdBills: billsSchema,
  countedKhrBills: billsSchema,
});

// レジ締めを確定。staff 以上。確定した system_cash_total が現金残高に積み上がる。
export const POST = withPosStaff('part_time', async (session, req) => {
  const json = await req.json().catch(() => null);
  const parsed = postSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data: existing } = await supabase.from('register_closings').select('id').eq('store_id', storeId).eq('date', d.date).maybeSingle();
  if (existing) {
    return NextResponse.json({ error: `${d.date} は既にレジ締め済みです。修正する場合は一度削除してからやり直してください。` }, { status: 409 });
  }

  let totals: SystemTotals;
  try {
    totals = await computeSystemTotals(supabase, storeId, d.date);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '集計に失敗しました' }, { status: 500 });
  }
  const khrRate = await getKhrRate(supabase, storeId);

  const usdSubtotal = USD_DENOMS.reduce((sum, denom) => sum + denom * (d.countedUsdBills[String(denom)] ?? 0), 0);
  const khrSubtotal = KHR_DENOMS.reduce((sum, denom) => sum + denom * (d.countedKhrBills[String(denom)] ?? 0), 0);
  const countedTotalUsd = usdSubtotal + khrSubtotal / khrRate;
  const differenceUsd = countedTotalUsd - totals.systemCashTotal;

  const { data, error } = await supabase
    .from('register_closings')
    .insert({
      store_id: storeId,
      date: d.date,
      shift: d.shift || null,
      system_cash_total: totals.systemCashTotal,
      system_totals_by_method: totals.systemTotalsByMethod,
      counted_usd_bills: d.countedUsdBills,
      counted_khr_bills: d.countedKhrBills,
      counted_total_usd: countedTotalUsd,
      difference_usd: differenceUsd,
      confirmed_by: session.staffId,
      confirmed_by_name: session.displayName,
    })
    .select(closingSelectCols)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ closing: toApi(data as ClosingRow) }, { status: 201 });
});
