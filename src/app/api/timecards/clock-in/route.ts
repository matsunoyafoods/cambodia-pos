import { NextResponse } from 'next/server';
import { createPosAdminClient } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';

// 出勤打刻 (2026-08-31 追加。勤怠記録機能)。既に出勤中 (clock_out が null の行がある) なら
// 二重出勤を防ぐためエラーにする (打刻画面側は status を先に見て出勤ボタンを隠すので、通常は
// 到達しない。二重タップ等の保険)。

export const POST = withPosStaff('staff', async (session) => {
  const supabase = createPosAdminClient();

  const { data: existing, error: existingError } = await supabase
    .from('timecards')
    .select('id')
    .eq('staff_id', session.staffId)
    .is('clock_out', null)
    .limit(1)
    .maybeSingle();
  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });
  if (existing) return NextResponse.json({ error: '既に出勤中です' }, { status: 409 });

  const { data, error } = await supabase
    .from('timecards')
    .insert({ staff_id: session.staffId, clock_in: new Date().toISOString(), breaks: [] })
    .select('id, clock_in, breaks')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ timecard: data }, { status: 201 });
});
