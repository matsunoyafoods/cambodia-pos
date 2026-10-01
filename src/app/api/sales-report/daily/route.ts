import { NextResponse } from 'next/server';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';
import { DEFAULT_TIME_PERIODS, type EthnicityKey, type TimePeriod } from '@/lib/pos-types';
import { computeGuestStats, computeTimePeriodSales } from '@/lib/sales-aggregation';

// 月間日々売上レポート (2026-09-02 追加。2026-10-01 客数・組数・人種内訳・時間帯別売上を追加)。
// Tom「AI分析をしたら月間日々売上... がダウンロードできるようにしたい」への対応で新設した
// 専用画面 (/pos/sales-report) 用のAPI。カンボジアはDST無しの固定 UTC+7。
// register-closings/route.ts の dayRangeUtc と同じ考え方。

const PHNOM_PENH_TZ = 'Asia/Phnom_Penh';

function monthRangeUtc(month: string): { startIso: string; endIso: string } {
  const [y, m] = month.split('-').map(Number);
  const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  const startIso = `${month}-01T00:00:00+07:00`;
  const endIso = `${nextMonth}-01T00:00:00+07:00`;
  return { startIso: new Date(startIso).toISOString(), endIso: new Date(endIso).toISOString() };
}

function toPhnomPenhDate(iso: string): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: PHNOM_PENH_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

async function getTimePeriods(supabase: ReturnType<typeof createPosAdminClient>, storeId: string): Promise<TimePeriod[]> {
  const { data } = await supabase.from('stores').select('settings').eq('id', storeId).maybeSingle();
  const stored = data?.settings as { timePeriods?: TimePeriod[] } | null;
  return Array.isArray(stored?.timePeriods) && stored.timePeriods.length > 0 ? stored.timePeriods : DEFAULT_TIME_PERIODS;
}

type OrderRow = {
  total: number;
  paid_at: string;
  guest_ethnicity: Partial<Record<EthnicityKey, number>> | null;
  guest_kids_count: number | null;
};

// GET /api/sales-report/daily?month=YYYY-MM : 指定月の日別売上合計・客数・組数・人種内訳・
// 時間帯別売上 + 月間合計。manager以上限定 (経費・現金残高等と同じく店舗の売上が見える情報のため)。
export const GET = withPosStaff('manager', async (_session, req) => {
  const url = new URL(req.url);
  const month = url.searchParams.get('month');
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'month (YYYY-MM) を指定してください' }, { status: 400 });
  }

  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();
  const { startIso, endIso } = monthRangeUtc(month);

  const [{ data, error }, timePeriods] = await Promise.all([
    supabase
      .from('orders')
      .select('total, paid_at, guest_ethnicity, guest_kids_count')
      .eq('store_id', storeId)
      .eq('status', 'paid')
      .gte('paid_at', startIso)
      .lt('paid_at', endIso),
    getTimePeriods(supabase, storeId),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const allRows = (data as OrderRow[] | null) ?? [];

  const byDate = new Map<string, OrderRow[]>();
  for (const row of allRows) {
    const date = toPhnomPenhDate(row.paid_at);
    const list = byDate.get(date);
    if (list) list.push(row);
    else byDate.set(date, [row]);
  }

  const days = Array.from(byDate.entries())
    .map(([date, rows]) => {
      const total = rows.reduce((s, r) => s + Number(r.total), 0);
      const guestStats = computeGuestStats(rows);
      return {
        date,
        total,
        orderCount: rows.length,
        guestCount: guestStats.guestCount,
        partyCount: guestStats.partyCount,
        ethnicityTotals: guestStats.ethnicityTotals,
        timePeriodSales: computeTimePeriodSales(rows, timePeriods),
      };
    })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const monthTotal = days.reduce((s, d) => s + d.total, 0);
  const orderCount = days.reduce((s, d) => s + d.orderCount, 0);
  const monthGuestStats = computeGuestStats(allRows);
  const monthTimePeriodSales = computeTimePeriodSales(allRows, timePeriods);

  return NextResponse.json({
    month,
    days,
    monthTotal,
    orderCount,
    guestCount: monthGuestStats.guestCount,
    partyCount: monthGuestStats.partyCount,
    ethnicityTotals: monthGuestStats.ethnicityTotals,
    timePeriodSales: monthTimePeriodSales,
    timePeriods,
  });
}, { deny: ['sub_manager'] });
