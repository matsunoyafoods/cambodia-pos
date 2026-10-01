import { NextResponse } from 'next/server';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';
import { DEFAULT_TIME_PERIODS, type EthnicityKey, type TimePeriod } from '@/lib/pos-types';
import { computeGuestStats, computeTimePeriodSales } from '@/lib/sales-aggregation';

// 本日の売上 (2026-09-04 追加。2026-10-01 客数・組数・人種内訳・時間帯別売上を追加)。
// Tom「POSレジなのに今の売上が分からない」への対応で、レジ画面 (pos-app.tsx) のヘッダーに
// 常時「本日の売上」を出すための軽量エンドポイント。/api/sales-report/daily (月間) の毎日集計と
// ロジックは同じだが、こちらは当日1日分だけを素早く返す。カンボジアはDST無しの固定 UTC+7
// (register-closings/route.ts の dayRangeUtc と同じ考え方)。

const PHNOM_PENH_TZ = 'Asia/Phnom_Penh';

function dayRangeUtc(date: string): { startIso: string; endIso: string } {
  const startIso = `${date}T00:00:00+07:00`;
  const endIso = new Date(new Date(startIso).getTime() + 24 * 60 * 60 * 1000).toISOString();
  return { startIso, endIso };
}

function todayPhnomPenh(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: PHNOM_PENH_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
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

// GET /api/sales-report/today : 本日 (Phnom Penh時間) の売上合計・件数・客数・組数・人種内訳・
// 時間帯別売上。
// 2026-09-04: レジ画面ヘッダーの常時表示用に、全スタッフ (part_time含む) が読めるよう開放。
// (Tom「売上の数字が大きくはっきり見えた方がスタッフ的には達成感がある」への対応。
// /pos/sales-report の詳細画面自体は引き続き owner/manager限定のまま、こちらは合計値だけの
// 軽量エンドポイントなので開放しても支障ない、という判断)。
export const GET = withPosStaff(
  'part_time',
  async () => {
    const supabase = createPosAdminClient();
    const storeId = getPosStoreId();
    const date = todayPhnomPenh();
    const { startIso, endIso } = dayRangeUtc(date);

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

    const rows = (data as OrderRow[] | null) ?? [];
    const total = rows.reduce((sum, row) => sum + Number(row.total), 0);
    const orderCount = rows.length;
    const guestStats = computeGuestStats(rows);
    const timePeriodSales = computeTimePeriodSales(rows, timePeriods);

    return NextResponse.json({
      date,
      total,
      orderCount,
      guestCount: guestStats.guestCount,
      partyCount: guestStats.partyCount,
      ethnicityTotals: guestStats.ethnicityTotals,
      timePeriodSales,
    });
  },
);
