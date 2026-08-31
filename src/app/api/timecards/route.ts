import { NextResponse } from 'next/server';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';
import type { TimecardBreak, TimecardRecord } from '@/lib/pos-types';

// 勤怠一覧・人件費レポート用 (2026-08-31 追加。manager 以上のみ — 給与に関わる情報のため)。
// pos.timecards.staff_id には外部キーが無い (0015_timecards_staff_id_no_fk.sql 参照) ため、
// pos.staff から店舗分の氏名を取得して手動でマージする。

export const GET = withPosStaff('manager', async (_session, req) => {
  const url = new URL(req.url);
  const from = url.searchParams.get('from'); // clock_in の日付 (YYYY-MM-DD) 以降
  const to = url.searchParams.get('to'); // clock_in の日付 (YYYY-MM-DD) 以前 (当日を含めるため翌日0時を渡すのは呼び出し側の責務)

  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data: staffRows, error: staffError } = await supabase.from('staff').select('id, display_name').eq('store_id', storeId);
  if (staffError) return NextResponse.json({ error: staffError.message }, { status: 500 });
  const nameById = new Map((staffRows ?? []).map((s) => [s.id, s.display_name]));
  const staffIds = (staffRows ?? []).map((s) => s.id);
  if (staffIds.length === 0) return NextResponse.json({ timecards: [] });

  let query = supabase
    .from('timecards')
    .select('id, staff_id, clock_in, clock_out, breaks, note, edited_by, edited_at')
    .in('staff_id', staffIds)
    .order('clock_in', { ascending: false });
  if (from) query = query.gte('clock_in', from);
  if (to) query = query.lte('clock_in', to);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const timecards: TimecardRecord[] = (data ?? []).map((row) => ({
    id: row.id,
    staffId: row.staff_id,
    staffName: nameById.get(row.staff_id) ?? '(不明なスタッフ)',
    clockIn: row.clock_in,
    clockOut: row.clock_out,
    breaks: (row.breaks ?? []) as TimecardBreak[],
    note: row.note,
    editedBy: row.edited_by,
    editedAt: row.edited_at,
  }));
  return NextResponse.json({ timecards });
});
