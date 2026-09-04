import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';

type RouteContext = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  hourlyWageUsd: z.number().min(0).max(1000).nullable().optional(),
  // 権限の変更 (2026-09-04 追加。既存スタッフの role を後から編集できるように)。
  role: z.enum(['owner', 'manager', 'sub_manager', 'employee', 'part_time']).optional(),
});

// スタッフの時給・権限を設定する (2026-08-31 時給追加、2026-09-04 role 追加)。
// manager 以上のみ (一覧取得の /api/staff と同じ権限)。
// ただし時給 (給料) は sub_manager には見せない/変更させない (Tom「サブマネージャーは
// スタッフの給料...は見ることができません」)。role の変更は sub_manager にも許可する
// (スタッフタブの一般的な管理操作として)。
export const PATCH = withPosStaff('manager', async (session, req, ctx: RouteContext) => {
  const { id } = await ctx.params;
  const json = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }
  if (parsed.data.hourlyWageUsd !== undefined && session.role === 'sub_manager') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const patch: Record<string, unknown> = {};
  if (parsed.data.hourlyWageUsd !== undefined) patch.hourly_wage_usd = parsed.data.hourlyWageUsd;
  if (parsed.data.role !== undefined) patch.role = parsed.data.role;

  const { data, error } = await supabase
    .from('staff')
    .update(patch)
    .eq('id', id)
    .eq('store_id', storeId)
    .select('id, display_name, role, active, hourly_wage_usd, created_at')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const staff = session.role === 'sub_manager' ? { ...data, hourly_wage_usd: undefined } : data;
  return NextResponse.json({ staff });
});
