import { NextResponse } from 'next/server';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';
import { ETHNICITY_KEYS, ETHNICITY_LABELS, type EthnicityKey } from '@/lib/pos-types';

// 日々のテーブルごとの売上明細レポート (2026-09-02 追加)。Tom「日々のテーブルごとの詳細
// （金額、国籍、人数、単価）が出るようにしてダウンロードできるように」への対応。
// 1行 = 1会計 (卓の1回の会計単位)。同じ卓が同じ日に複数回転しても行は分かれる。
//
// 国籍・人数は §0.1d の客層記録 (pos.orders.guest_ethnicity / guest_kids_count、会計時に記録)
// をそのまま使う。人数 = 国籍内訳の合計 + 子供人数。単価 = 会計金額 ÷ 人数 (人数0件・未記録の
// 場合は算出不能として null を返す)。

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

type OrderRow = {
  id: string;
  table_code: string | null;
  total: number;
  paid_at: string;
  guest_ethnicity: Partial<Record<EthnicityKey, number>> | null;
  guest_kids_count: number | null;
};

// GET /api/sales-report/tables?month=YYYY-MM : 指定月の会計 (卓) 別明細。manager以上限定。
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
    .select('id, table_code, total, paid_at, guest_ethnicity, guest_kids_count')
    .eq('store_id', storeId)
    .eq('status', 'paid')
    .gte('paid_at', startIso)
    .lt('paid_at', endIso)
    .order('paid_at', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data as OrderRow[] | null ?? []).map((row) => {
    const ethnicity = row.guest_ethnicity ?? {};
    const ethnicityTotal = ETHNICITY_KEYS.reduce((sum, key) => sum + (ethnicity[key] ?? 0), 0);
    const kidsCount = row.guest_kids_count ?? 0;
    const partySize = ethnicityTotal + kidsCount;
    const total = Number(row.total);
    return {
      orderId: row.id,
      date: toPhnomPenhDate(row.paid_at),
      tableCode: row.table_code ?? '-',
      total,
      ethnicity: ETHNICITY_KEYS.filter((key) => (ethnicity[key] ?? 0) > 0).map((key) => ({ label: ETHNICITY_LABELS[key], count: ethnicity[key]! })),
      kidsCount,
      partySize,
      unitPrice: partySize > 0 ? total / partySize : null,
    };
  });

  return NextResponse.json({ month, rows });
}, { deny: ['sub_manager'] });
