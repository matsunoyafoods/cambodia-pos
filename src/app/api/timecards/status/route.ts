import { NextResponse } from 'next/server';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';
import { getTimecardHistoryResetTime, historyWindowStartIso, resolveTargetStaffId } from '@/lib/timecard-server';
import type { TimecardBreak, TimecardStatus } from '@/lib/pos-types';

// 勤怠状態 (出勤・休憩中・退勤済み) を取得する (2026-08-31 追加。勤怠記録機能)。
// 打刻画面 (/pos/timecard) が、押せるボタンを出し分けるために使う。
// 2026-09-01: クエリパラメータ ?staffId=... で対象スタッフを指定できるようにした
// (共有端末でプルダウンから選んだスタッフの状態を見るため)。省略時は従来通り本人。
//
// pos.timecards には store_id が無いが、staff_id (=pos.staff.id) は元々1店舗にしか
// 属さないため、staff_id で絞り込むだけで店舗を跨いだ混線は起きない (staffId は
// resolveTargetStaffId() で自店舗の pos.staff に実在するかを必ず検証してから使う)。
//
// 2026-09-28 追加: 打刻画面に「本日の打刻履歴」を表示するため、todayPunches も一緒に返す
// (Tom「出勤・退勤しても同じ画面に履歴が残るようにしてほしい。その履歴は設定した時間に消えて、
// 毎日見た目もスッキリするように」への対応)。「本日」の起点は settings.timecardHistoryResetTime
// (店舗設定、デフォルト00:00=深夜0時) を Phnom Penh時間で解釈した直近の到来時刻。履歴は
// スタッフ (targetStaffId) ごとに個別に保存・表示される — 実データは一切削除しない、
// あくまで表示フィルタ。todayPhnomPenh/historyWindowStartIso/getTimecardHistoryResetTime は
// 2026-09-28 に timecard-server.ts へ共通化 (api/timecards/today でも同じロジックを使うため)。

export const GET = withPosStaff('part_time', async (session, req) => {
  const url = new URL(req.url);
  const resolved = await resolveTargetStaffId(session, url.searchParams.get('staffId'));
  if (resolved.error) return NextResponse.json({ error: resolved.error }, { status: 400 });
  const targetStaffId = resolved.staffId;

  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data: current, error } = await supabase
    .from('timecards')
    .select('id, staff_id, clock_in, clock_out, breaks, note')
    .eq('staff_id', targetStaffId)
    .is('clock_out', null)
    .order('clock_in', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const storedResetTime = await getTimecardHistoryResetTime(supabase, storeId);
  const windowStartIso = historyWindowStartIso(storedResetTime);

  const { data: todayRows, error: todayError } = await supabase
    .from('timecards')
    .select('id, clock_in, clock_out, breaks')
    .eq('staff_id', targetStaffId)
    .gte('clock_in', windowStartIso)
    .order('clock_in', { ascending: false });
  if (todayError) return NextResponse.json({ error: todayError.message }, { status: 500 });
  const todayPunches = (todayRows ?? []).map((row) => ({
    id: row.id,
    clockIn: row.clock_in,
    clockOut: row.clock_out,
    breaks: (row.breaks ?? []) as TimecardBreak[],
  }));

  if (!current) {
    return NextResponse.json({ status: 'not_clocked_in' as TimecardStatus, timecard: null, todayPunches });
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
    todayPunches,
  });
});
