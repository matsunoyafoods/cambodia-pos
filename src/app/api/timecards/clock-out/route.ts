import { NextResponse } from 'next/server';
import { createPosAdminClient } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';
import { resolveTargetStaffId } from '@/lib/timecard-server';
import type { TimecardBreak } from '@/lib/pos-types';

// 退勤打刻 (2026-08-31 追加。勤怠記録機能)。休憩を終え忘れたまま退勤した場合、その休憩は
// 退勤時刻で自動的に終了させる (延々と「休憩中」のまま残ってしまうことを防ぐ)。
// 2026-09-01: リクエストボディの staffId で対象スタッフを指定できるようにした (共有端末対応)。

export const POST = withPosStaff('staff', async (session, req) => {
  const json = await req.json().catch(() => ({}) as { staffId?: string });
  const resolved = await resolveTargetStaffId(session, json?.staffId);
  if (resolved.error) return NextResponse.json({ error: resolved.error }, { status: 400 });
  const targetStaffId = resolved.staffId;

  const supabase = createPosAdminClient();

  const { data: current, error: findError } = await supabase
    .from('timecards')
    .select('id, breaks')
    .eq('staff_id', targetStaffId)
    .is('clock_out', null)
    .order('clock_in', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (findError) return NextResponse.json({ error: findError.message }, { status: 500 });
  if (!current) return NextResponse.json({ error: '出勤していません' }, { status: 409 });

  const nowIso = new Date().toISOString();
  const breaks = (current.breaks ?? []) as TimecardBreak[];
  const nextBreaks = breaks.slice();
  if (nextBreaks.length > 0 && nextBreaks[nextBreaks.length - 1].endedAt === null) {
    nextBreaks[nextBreaks.length - 1] = { ...nextBreaks[nextBreaks.length - 1], endedAt: nowIso };
  }

  const { data, error } = await supabase
    .from('timecards')
    .update({ clock_out: nowIso, breaks: nextBreaks })
    .eq('id', current.id)
    .select('id, clock_in, clock_out, breaks')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ timecard: data });
});
