import { NextResponse } from 'next/server';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';

// 月間日々売上レポート (2026-09-02 追加)。Tom「AI分析をしたら月間日々売上... がダウンロード
// できるようにしたい」への対応で新設した専用画面 (/pos/sales-report) 用のAPI。
// カンボジアはDST無しの固定 UTC+7。register-closings/route.ts の dayRangeUtc と同じ考え方。

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

// GET /api/sales-report/daily?month=YYYY-MM : 指定月の日別売上合計。manager以上限定
// (経費・現金残高等と同じく店舗の売上が見える情報のため)。
export const GET = withPosStaff('manager', async (_session, req) => {
  const url = new URL(req.url);
  const month = url.searchParams.get('month');
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'month (YYYY-MM) を指定してください' }, { status: 400 });
  }

  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();
  const { startIso, endIso } = monthRangeUtc(month);

  const { data, error } = await supabase
    .from('orders')
    .select('total, paid_at')
    .eq('store_id', storeId)
    .eq('status', 'paid')
    .gte('paid_at', startIso)
    .lt('paid_at', endIso);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const byDate = new Map<string, { total: number; orderCount: number }>();
  for (const row of data ?? []) {
    const date = toPhnomPenhDate(row.paid_at as string);
    const entry = byDate.get(date) ?? { total: 0, orderCount: 0 };
    entry.total += Number(row.total);
    entry.orderCount += 1;
    byDate.set(date, entry);
  }

  const days = Array.from(byDate.entries())
    .map(([date, v]) => ({ date, total: v.total, orderCount: v.orderCount }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const monthTotal = days.reduce((s, d) => s + d.total, 0);
  const orderCount = days.reduce((s, d) => s + d.orderCount, 0);

  return NextResponse.json({ month, days, monthTotal, orderCount });
});
