import { NextResponse } from 'next/server';
import { createPosAdminClient } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';
import type { TimecardBreak } from '@/lib/pos-types';

// 休憩終了 (2026-08-31 追加。勤怠記録機能)。

export const POST = withPosStaff('staff', async (session) => {
  const supabase = createPosAdminClient();

  const { data: current, error: findError } = await supabase
    .from('timecards')
    .select('id, breaks')
    .eq('staff_id', session.staffId)
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
