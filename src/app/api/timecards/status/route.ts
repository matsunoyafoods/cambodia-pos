import { NextResponse } from 'next/server';
import { createPosAdminClient } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';
import type { TimecardBreak, TimecardStatus } from '@/lib/pos-types';

// 自分の勤怠状態 (出勤・休憩中・退勤済み) を取得する (2026-08-31 追加。勤怠記録機能)。
// 打刻画面 (/pos/timecard) が、押せるボタンを出し分けるために使う。
//
// pos.timecards には store_id が無いが、staff_id (=pos.staff.id) は元々1店舗にしか
// 属さないため、staff_id で絞り込むだけで店舗を跨いだ混線は起きない (session.staffId は
// 認証済みセッションから取得したものだけを使い、クライアント入力は一切信用しない)。

export const GET = withPosStaff('staff', async (session) => {
  const supabase = createPosAdminClient();

  const { data: current, error } = await supabase
    .from('timecards')
    .select('id, staff_id, clock_in, clock_out, breaks, note')
    .eq('staff_id', session.staffId)
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
