import { NextResponse } from 'next/server';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';

// レジ締め月報 (Cash Register Closing Report、2026-11-11 追加)。
// Tom「税理士がこの情報が入っていてほしい」→ 税理士向けに従来手作業で作っていた月報
// (日付・曜日・レジ開け/締め現金・支払い方法別売上・合計・不明金・小口資金・現金売上・納金額・納金袋残高)
// を POS のデータから毎月出せるようにする。
//
// 各列の定義:
// - open (レジ開け現金)  = その日のレジ締めに記録されたレジ金 (register_float_usd)
// - final (レジ締め現金) = その日のレジ締めで数えた金額 (counted_total_usd)
// - 支払い方法別         = その日に会計確定した注文の pos.payments を決済方法名ごとに合計
//                          (現金は店舗設定で「現金として扱う」(is_cash) の決済方法)
// - unknown (不明金)     = レジ締めの差額 (difference_usd、数えた額 − (レジ金 + システム現金売上))
// - pettyCash (小口資金) = 支払元「レジの現金」で支払い済みの経費 (expenses.paid_from = register_cash)
// - netCash (現金売上)   = 現金 + 不明金 − 小口資金
// - deposit (納金額)     = 銀行入金 (cash_deposits)
// - 納金袋残高           = 前月繰越 + Σ(netCash − deposit)。画面側で累計する。
//
// 前月繰越 (carryForward): 現金残高の起点 (settings.cashBalanceBaseline、追記10) より後の月だけ
// 起点 + 起点翌日〜前月末の Σ(netCash − deposit) で自動計算する。起点以前の月は null を返し、
// 画面で手入力する (起点より前は現金記録が不完全な期間があるため自動計算しない)。

const PHNOM_PENH_TZ = 'Asia/Phnom_Penh';

function toPhnomPenhDate(iso: string): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: PHNOM_PENH_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

type Supabase = ReturnType<typeof createPosAdminClient>;

type DayAgg = {
  date: string;
  hasClosing: boolean;
  open: number | null;
  final: number | null;
  byMethod: Record<string, number>;
  cash: number;
  total: number;
  unknown: number;
  pettyCash: number;
  netCash: number;
  deposit: number;
};

// [fromDate, toDate] (両端含む、プノンペン日付) の日別集計。
async function aggregateDays(supabase: Supabase, storeId: string, fromDate: string, toDate: string, cashNames: Set<string>) {
  const startIso = new Date(`${fromDate}T00:00:00+07:00`).toISOString();
  const endIso = new Date(`${addDays(toDate, 1)}T00:00:00+07:00`).toISOString();

  const [ordersRes, closingsRes, expensesRes, depositsRes] = await Promise.all([
    supabase.from('orders').select('id, paid_at').eq('store_id', storeId).eq('status', 'paid').gte('paid_at', startIso).lt('paid_at', endIso),
    supabase
      .from('register_closings')
      .select('date, counted_total_usd, difference_usd, register_float_usd, confirmed_at')
      .eq('store_id', storeId)
      .gte('date', fromDate)
      .lte('date', toDate)
      .order('confirmed_at'),
    supabase
      .from('expenses')
      .select('date, amount_usd')
      .eq('store_id', storeId)
      .eq('paid_from', 'register_cash')
      .eq('payment_status', 'paid')
      .gte('date', fromDate)
      .lte('date', toDate),
    supabase.from('cash_deposits').select('date, amount_usd').eq('store_id', storeId).gte('date', fromDate).lte('date', toDate),
  ]);
  for (const r of [ordersRes, closingsRes, expensesRes, depositsRes]) {
    if (r.error) throw new Error(r.error.message);
  }

  const days = new Map<string, DayAgg>();
  const get = (date: string): DayAgg => {
    let d = days.get(date);
    if (!d) {
      d = { date, hasClosing: false, open: null, final: null, byMethod: {}, cash: 0, total: 0, unknown: 0, pettyCash: 0, netCash: 0, deposit: 0 };
      days.set(date, d);
    }
    return d;
  };

  const orders = (ordersRes.data as { id: string; paid_at: string }[] | null) ?? [];
  const dateByOrder = new Map(orders.map((o) => [o.id, toPhnomPenhDate(o.paid_at)]));
  const orderIds = orders.map((o) => o.id);
  for (let i = 0; i < orderIds.length; i += 200) {
    const { data: payments, error } = await supabase
      .from('payments')
      .select('order_id, method, amount')
      .in('order_id', orderIds.slice(i, i + 200));
    if (error) throw new Error(error.message);
    for (const p of (payments as { order_id: string; method: string; amount: number }[] | null) ?? []) {
      const date = dateByOrder.get(p.order_id);
      if (!date) continue;
      const d = get(date);
      const amount = Number(p.amount);
      d.byMethod[p.method] = round2((d.byMethod[p.method] ?? 0) + amount);
      d.total = round2(d.total + amount);
      if (cashNames.has(p.method)) d.cash = round2(d.cash + amount);
    }
  }

  // 同じ日に複数回 (シフト別) のレジ締めがある場合: レジ開けは最初の回のレジ金、
  // レジ締めはレジ金 + 各回の (数えた額 − レジ金) の合計、不明金は各回の差額の合計。
  for (const c of (closingsRes.data as {
    date: string;
    counted_total_usd: number;
    difference_usd: number;
    register_float_usd: number | null;
  }[] | null) ?? []) {
    const d = get(c.date);
    const float = Number(c.register_float_usd ?? 0);
    if (!d.hasClosing) {
      d.hasClosing = true;
      d.open = float;
      d.final = float;
    }
    d.final = round2((d.final ?? 0) + Number(c.counted_total_usd) - float);
    d.unknown = round2(d.unknown + Number(c.difference_usd));
  }
  for (const e of (expensesRes.data as { date: string; amount_usd: number }[] | null) ?? []) {
    const d = get(e.date);
    d.pettyCash = round2(d.pettyCash + Number(e.amount_usd));
  }
  for (const dep of (depositsRes.data as { date: string; amount_usd: number }[] | null) ?? []) {
    const d = get(dep.date);
    d.deposit = round2(d.deposit + Number(dep.amount_usd));
  }
  for (const d of days.values()) {
    d.netCash = round2(d.cash + d.unknown - d.pettyCash);
  }
  return days;
}

// GET /api/sales-report/closing-report?month=YYYY-MM  (owner/manager)
export const GET = withPosStaff('manager', async (_session, req) => {
  const month = new URL(req.url).searchParams.get('month');
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'month (YYYY-MM) を指定してください' }, { status: 400 });
  }

  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const [storeRes, methodsRes] = await Promise.all([
    supabase.from('stores').select('settings').eq('id', storeId).maybeSingle(),
    supabase.from('payment_methods').select('name, is_cash, enabled, sort_order').eq('store_id', storeId).order('sort_order'),
  ]);
  if (storeRes.error) return NextResponse.json({ error: storeRes.error.message }, { status: 500 });
  if (methodsRes.error) return NextResponse.json({ error: methodsRes.error.message }, { status: 500 });

  const settings = (storeRes.data?.settings ?? {}) as {
    khrRate?: number;
    cashBalanceBaseline?: { asOfDate?: string; amountUsd?: number };
  };
  const khrRate = typeof settings.khrRate === 'number' ? settings.khrRate : 4100;
  const rawBaseline = settings.cashBalanceBaseline;
  const baseline =
    rawBaseline && typeof rawBaseline.asOfDate === 'string' && typeof rawBaseline.amountUsd === 'number'
      ? { asOfDate: rawBaseline.asOfDate, amountUsd: rawBaseline.amountUsd }
      : null;

  const methodRows = (methodsRes.data as { name: string; is_cash: boolean; enabled: boolean }[] | null) ?? [];
  const cashNames = new Set(methodRows.filter((m) => m.is_cash).map((m) => m.name));
  if (cashNames.size === 0) cashNames.add('現金');

  const monthStart = `${month}-01`;
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const monthEnd = `${month}-${String(lastDay).padStart(2, '0')}`;

  try {
    const dayMap = await aggregateDays(supabase, storeId, monthStart, monthEnd, cashNames);

    let carryForward: number | null = null;
    if (baseline && baseline.asOfDate < monthStart) {
      carryForward = baseline.amountUsd;
      const from = addDays(baseline.asOfDate, 1);
      const to = addDays(monthStart, -1);
      if (from <= to) {
        const prior = await aggregateDays(supabase, storeId, from, to, cashNames);
        for (const d of prior.values()) carryForward += d.netCash - d.deposit;
      }
      carryForward = round2(carryForward);
    }

    // 列: 現金 → 有効な決済方法 (設定の並び順) → 月内に使われたその他の決済方法名 (削除済み等)
    const nonCashMethods: string[] = methodRows.filter((r) => !r.is_cash && r.enabled).map((r) => r.name);
    for (const d of dayMap.values()) {
      for (const name of Object.keys(d.byMethod)) {
        if (!cashNames.has(name) && !nonCashMethods.includes(name)) nonCashMethods.push(name);
      }
    }

    const days: DayAgg[] = [];
    for (let i = 0; i < lastDay; i += 1) {
      const date = addDays(monthStart, i);
      days.push(
        dayMap.get(date) ?? {
          date,
          hasClosing: false,
          open: null,
          final: null,
          byMethod: {},
          cash: 0,
          total: 0,
          unknown: 0,
          pettyCash: 0,
          netCash: 0,
          deposit: 0,
        },
      );
    }

    return NextResponse.json({
      month,
      khrRate,
      cashLabel: Array.from(cashNames)[0],
      methods: nonCashMethods,
      days,
      carryForward,
      // 起点の日が月内にある場合、その日の終わりで納金袋残高を起点の額に合わせ直す (画面側で処理)。
      baseline: baseline && baseline.asOfDate >= monthStart && baseline.asOfDate <= monthEnd ? baseline : null,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'failed' }, { status: 500 });
  }
}, { deny: ['sub_manager'] });
