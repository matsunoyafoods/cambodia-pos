import { NextResponse } from 'next/server';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';
import { getTimecardHistoryResetTime, historyWindowStartIso } from '@/lib/timecard-server';
import type { TimecardBreak, TimecardRecord } from '@/lib/pos-types';

// 本日の全スタッフ打刻履歴 (2026-09-28 追加。Tom「みんなの履歴が残るようにしてください」
// →「履歴は全員見れるようにしてください」で全ロール閲覧可に変更)。
// 閲覧は part_time 以上 (=全スタッフ) に開放。編集・削除は既存の api/timecards/[id]/route.ts
// (PATCH/DELETE、どちらも manager 以上) をそのまま使う — 閲覧を全員に開放しても、編集・削除の
// 権限 (人件費に関わる操作のため manager 以上限定) は変更していない。「本日」の起点は個人向け
// 履歴 (api/timecards/status) と同じ historyWindowStartIso() (店舗設定 timecardHistoryResetTime)
// による計算。
export const GET = withPosStaff('part_time', async (_session, _req) => {
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data: staffRows, error: staffError } = await supabase.from('staff').select('id, display_name').eq('store_id', storeId);
  if (staffError) return NextResponse.json({ error: staffError.message }, { status: 500 });
  const nameById = new Map((staffRows ?? []).map((s) => [s.id, s.display_name]));
  const staffIds = (staffRows ?? []).map((s) => s.id);
  if (staffIds.length === 0) return NextResponse.json({ timecards: [] });

  const resetTime = await getTimecardHistoryResetTime(supabase, storeId);
  const windowStartIso = historyWindowStartIso(resetTime);

  const { data, error } = await supabase
    .from('timecards')
    .select('id, staff_id, clock_in, clock_out, breaks, note, edited_by, edited_at')
    .in('staff_id', staffIds)
    .gte('clock_in', windowStartIso)
    .order('clock_in', { ascending: false });
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
