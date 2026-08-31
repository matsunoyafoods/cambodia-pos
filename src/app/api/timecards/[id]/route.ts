import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';
import type { TimecardBreak, TimecardRecord } from '@/lib/pos-types';

type RouteContext = { params: Promise<{ id: string }> };

const breakSchema = z.object({ startedAt: z.string(), endedAt: z.string().nullable() });

const patchSchema = z.object({
  clockIn: z.string().optional(),
  clockOut: z.string().nullable().optional(),
  breaks: z.array(breakSchema).optional(),
  note: z.string().trim().max(300).nullable().optional(),
});

// pos.timecards.staff_id には外部キーが無いため (0015_timecards_staff_id_no_fk.sql 参照)、
// 対象の timecard が自店舗のスタッフのものであることを毎回確認してから更新・削除する
// (店舗を跨いだ推測アクセスを防ぐ。将来 D-簡易で複数店舗が同一Supabaseプロジェクトを
// 共有するようになった時の安全性のため)。
async function assertOwnedByThisStore(
  supabase: ReturnType<typeof createPosAdminClient>,
  timecardId: string,
): Promise<boolean> {
  const { data: tc } = await supabase.from('timecards').select('staff_id').eq('id', timecardId).maybeSingle();
  if (!tc) return false;
  const storeId = getPosStoreId();
  const { data: staffRow } = await supabase.from('staff').select('id').eq('id', tc.staff_id).eq('store_id', storeId).maybeSingle();
  return !!staffRow;
}

// 打刻の手動修正 (押し忘れ・押し間違いの訂正)。manager 以上のみ。
// edited_by/edited_at に修正者・修正時刻を記録し、修正が入ったことが後から分かるようにする。
export const PATCH = withPosStaff('manager', async (session, req, ctx: RouteContext) => {
  const { id } = await ctx.params;
  const json = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;
  const supabase = createPosAdminClient();

  if (!(await assertOwnedByThisStore(supabase, id))) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const patch: Record<string, unknown> = { edited_by: session.staffId, edited_at: new Date().toISOString() };
  if (d.clockIn !== undefined) patch.clock_in = d.clockIn;
  if (d.clockOut !== undefined) patch.clock_out = d.clockOut;
  if (d.breaks !== undefined) patch.breaks = d.breaks satisfies TimecardBreak[];
  if (d.note !== undefined) patch.note = d.note;

  const { data, error } = await supabase
    .from('timecards')
    .update(patch)
    .eq('id', id)
    .select('id, staff_id, clock_in, clock_out, breaks, note, edited_by, edited_at')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: staffRow } = await supabase.from('staff').select('display_name').eq('id', data.staff_id).maybeSingle();
  const timecard: TimecardRecord = {
    id: data.id,
    staffId: data.staff_id,
    staffName: staffRow?.display_name ?? '(不明なスタッフ)',
    clockIn: data.clock_in,
    clockOut: data.clock_out,
    breaks: (data.breaks ?? []) as TimecardBreak[],
    note: data.note,
    editedBy: data.edited_by,
    editedAt: data.edited_at,
  };
  return NextResponse.json({ timecard });
});

// 削除 (テスト打刻・完全な誤登録の削除用)。manager 以上のみ。
export const DELETE = withPosStaff('manager', async (_session, _req, ctx: RouteContext) => {
  const { id } = await ctx.params;
  const supabase = createPosAdminClient();
  if (!(await assertOwnedByThisStore(supabase, id))) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const { error } = await supabase.from('timecards').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
});
