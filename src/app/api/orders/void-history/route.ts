import { NextResponse } from 'next/server';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';

// 会計取消履歴の一覧 (2026-09-20 追加)。manager以上限定 (deny sub_manager。sales-report と
// 同じ権限線引き)。指定月に取消された注文の一覧を、取消前の金額・理由・実行者とあわせて返す。

const PHNOM_PENH_TZ = 'Asia/Phnom_Penh';

function monthRangeUtc(month: string): { startIso: string; endIso: string } {
  const [y, m] = month.split('-').map(Number);
  const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  const startIso = `${month}-01T00:00:00+07:00`;
  const endIso = `${nextMonth}-01T00:00:00+07:00`;
  return { startIso: new Date(startIso).toISOString(), endIso: new Date(endIso).toISOString() };
}

function toPhnomPenhDateTime(iso: string): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: PHNOM_PENH_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(new Date(iso))
    .replace(',', '');
}

type VoidLogRow = {
  id: string;
  order_id: string;
  table_code: string | null;
  reason: string | null;
  snapshot: { total?: number } | null;
  voided_by_name: string | null;
  voided_at: string;
};

export const GET = withPosStaff(
  'manager',
  async (_session, req) => {
    const url = new URL(req.url);
    const month = url.searchParams.get('month');
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: 'month (YYYY-MM) を指定してください' }, { status: 400 });
    }

    const supabase = createPosAdminClient();
    const storeId = getPosStoreId();
    const { startIso, endIso } = monthRangeUtc(month);

    const { data, error } = await supabase
      .from('order_void_log')
      .select('id, order_id, table_code, reason, snapshot, voided_by_name, voided_at')
      .eq('store_id', storeId)
      .gte('voided_at', startIso)
      .lt('voided_at', endIso)
      .order('voided_at', { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const rows = (data as VoidLogRow[] | null ?? []).map((row) => ({
      id: row.id,
      orderId: row.order_id,
      tableCode: row.table_code ?? '-',
      voidedTotal: Number(row.snapshot?.total ?? 0),
      reason: row.reason,
      voidedByName: row.voided_by_name,
      voidedAt: toPhnomPenhDateTime(row.voided_at),
    }));

    return NextResponse.json({ month, rows });
  },
  { deny: ['sub_manager'] },
);
