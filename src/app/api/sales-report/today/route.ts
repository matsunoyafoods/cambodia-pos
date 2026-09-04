import { NextResponse } from 'next/server';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';

// 本日の売上 (2026-09-04 追加)。Tom「POSレジなのに今の売上が分からない」への対応で、
// レジ画面 (pos-app.tsx) のヘッダーに常時「本日の売上」を出すための軽量エンドポイント。
// /api/sales-report/daily (月間) の毎日集計とロジックは同じだが、こちらは当日1日分だけを
// 素早く返す。カンボジアはDST無しの固定 UTC+7 (register-closings/route.ts の dayRangeUtc と同じ考え方)。

const PHNOM_PENH_TZ = 'Asia/Phnom_Penh';

function dayRangeUtc(date: string): { startIso: string; endIso: string } {
  const startIso = `${date}T00:00:00+07:00`;
  const endIso = new Date(new Date(startIso).getTime() + 24 * 60 * 60 * 1000).toISOString();
  return { startIso, endIso };
}

function todayPhnomPenh(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: PHNOM_PENH_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

// GET /api/sales-report/today : 本日 (Phnom Penh時間) の売上合計・件数。
// manager以上限定・sub_manager除外 (他の売上関連APIと同じ権限)。
export const GET = withPosStaff(
  'manager',
  async () => {
    const supabase = createPosAdminClient();
    const storeId = getPosStoreId();
    const date = todayPhnomPenh();
    const { startIso, endIso } = dayRangeUtc(date);

    const { data, error } = await supabase
      .from('orders')
      .select('total')
      .eq('store_id', storeId)
      .eq('status', 'paid')
      .gte('paid_at', startIso)
      .lt('paid_at', endIso);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const total = (data ?? []).reduce((sum, row) => sum + Number(row.total), 0);
    const orderCount = (data ?? []).length;

    return NextResponse.json({ date, total, orderCount });
  },
  { deny: ['sub_manager'] },
);
