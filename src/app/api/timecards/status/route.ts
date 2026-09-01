import { NextResponse } from 'next/server';
import { createPosAdminClient } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';
import { resolveTargetStaffId } from '@/lib/timecard-server';
import type { TimecardBreak, TimecardStatus } from '@/lib/pos-types';

// 勤怠状態 (出勤・休憩中・退勤済み) を取得する (2026-08-31 追加。勤怠記録機能)。
// 打刻画面 (/pos/timecard) が、押せるボタンを出し分けるために使う。
// 2026-09-01: クエリパラメータ ?staffId=... で対象スタッフを指定できるようにした
// (共有端末でプルダウンから選んだスタッフの状態を見るため)。省略時は従来通り本人。
//
// pos.timecards には store_id が無いが、staff_id (=pos.staff.id) は元々1店舗にしか
// 属さないため、staff_id で絞り込むだけで店舗を跨いだ混線は起きない (staffId は
// resolveTargetStaffId() で自店舗の pos.staff に実在するかを必ず検証してから使う)。

export const GET = withPosStaff('staff', async (session, req) => {
  const url = new URL(req.url);
  const resolved = await resolveTargetStaffId(session, url.searchParams.get('staffId'));
  if (resolved.error) return NextResponse.json({ error: resolved.error }, { status: 400 });
  const targetStaffId = resolved.staffId;

  const supabase = createPosAdminClient();

  const { data: current, error } = await supabase
    .from('timecards')
    .select('id, staff_id, clock_in, clock_out, breaks, note')
    .eq('staff_id', targetStaffId)
    .is('clock_out', null)
    .order('clock_in', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (!current) {
    return NextResponse.json({ status: 'not_clocked_in' as TimecardStatus, timecard: null });
  }
  const breaks = (current.breaks ?? []) as TimecardBreak[];
  const onBreak = breaks.length > 0 && breaks[breaks.length - 1].endedAt === null;
  const status: TimecardStatus = onBreak ? 'on_break' : 'working';
  return NextResponse.json({
    status,
    timecard: {
      id: current.id,
      clockIn: current.clock_in,
      breaks,
    },
  });
});
