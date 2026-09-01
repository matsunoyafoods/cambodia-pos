import { NextResponse } from 'next/server';
import { createPosAdminClient } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';
import { resolveTargetStaffId } from '@/lib/timecard-server';
import type { TimecardBreak } from '@/lib/pos-types';

// 休憩開始 (2026-08-31 追加。勤怠記録機能)。breaks は [{startedAt, endedAt}] の配列で
// 1行の timecard に持たせる (複数回の休憩に対応)。
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

  const breaks = (current.breaks ?? []) as TimecardBreak[];
  if (breaks.length > 0 && breaks[breaks.length - 1].endedAt === null) {
    return NextResponse.json({ error: '既に休憩中です' }, { status: 409 });
  }
  const nextBreaks: TimecardBreak[] = [...breaks, { startedAt: new Date().toISOString(), endedAt: null }];

  const { data, error } = await supabase.from('timecards').update({ breaks: nextBreaks }).eq('id', current.id).select('id, breaks').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ timecard: data });
});
