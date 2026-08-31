import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';

type RouteContext = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  hourlyWageUsd: z.number().min(0).max(1000).nullable().optional(),
});

// スタッフの時給を設定する (2026-08-31 追加。人件費レポートで時給×勤務時間を計算するため)。
// 給与に関わる情報のため manager 以上のみ (一覧取得の /api/staff と同じ権限)。
export const PATCH = withPosStaff('manager', async (_session, req, ctx: RouteContext) => {
  const { id } = await ctx.params;
  const json = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const patch: Record<string, unknown> = {};
  if (parsed.data.hourlyWageUsd !== undefined) patch.hourly_wage_usd = parsed.data.hourlyWageUsd;

  const { data, error } = await supabase
    .from('staff')
    .update(patch)
    .eq('id', id)
    .eq('store_id', storeId)
    .select('id, display_name, role, active, hourly_wage_usd, created_at')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ staff: data });
});
