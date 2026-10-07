import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';

type RouteContext = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  // 権限の変更 (2026-09-04 追加。既存スタッフの role を後から編集できるように)。
  role: z.enum(['owner', 'manager', 'sub_manager', 'employee', 'part_time']).optional(),
});

// スタッフの権限を設定する (2026-09-04 role 追加)。
// 2026-10-07: 時給 (hourlyWageUsd) フィールドを削除した。Tom「人件費計算がおかしいです。
// 今の時給入力は削除してください。休んだ時の人件費計算式は休んだ分を日割り控除。」への対応。
// 人件費は給与計算 (/pos/payroll, src/lib/payroll/calc.ts) の「基準給 ÷ 標準勤務日数 = 日額」
// を欠勤日数分だけ控除する方式に一本化し、この時給×実働時間ベースの概算は廃止した。
// manager 以上のみ (一覧取得の /api/staff と同じ権限)。
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
  if (parsed.data.role !== undefined) patch.role = parsed.data.role;

  const { data, error } = await supabase
    .from('staff')
    .update(patch)
    .eq('id', id)
    .eq('store_id', storeId)
    .select('id, display_name, role, active, created_at')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ staff: data });
});
