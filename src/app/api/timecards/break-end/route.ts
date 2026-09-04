import { NextResponse } from 'next/server';
import { createPosAdminClient } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';
import { resolveTargetStaffId } from '@/lib/timecard-server';
import type { TimecardBreak } from '@/lib/pos-types';

// 休憩終了 (2026-08-31 追加。勤怠記録機能)。
// 2026-09-01: リクエストボディの staffId で対象スタッフを指定できるようにした (共有端末対応)。

export const POST = withPosStaff('part_time', async (session, req) => {
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
  if (breaks.length === 0 || breaks[breaks.length - 1].endedAt !== null) {
    return NextResponse.json({ error: '休憩中ではありません' }, { status: 409 });
  }
  const nextBreaks = breaks.slice();
  nextBreaks[nextBreaks.length - 1] = { ...nextBreaks[nextBreaks.length - 1], endedAt: new Date().toISOString() };

  const { data, error } = await supabase.from('timecards').update({ breaks: nextBreaks }).eq('id', current.id).select('id, breaks').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ timecard: data });
});
