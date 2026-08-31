import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';
import type { ExpenseCategory } from '@/lib/pos-types';

type RouteContext = { params: Promise<{ id: string }> };

function toCategory(row: { id: string; name: string; sort_order: number }): ExpenseCategory {
  return { id: row.id, name: row.name, sortOrder: row.sort_order };
}

const patchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  sortOrder: z.number().int().optional(),
});

// 名称変更・並び替え。manager 以上のみ。
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
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.sortOrder !== undefined) patch.sort_order = parsed.data.sortOrder;

  const { data, error } = await supabase
    .from('expense_categories')
    .update(patch)
    .eq('id', id)
    .eq('store_id', storeId)
    .select('id, name, sort_order')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ category: toCategory(data) });
});

// 削除。過去の経費記録は category を自由文字列でスナップショット済みのため影響しない。manager 以上のみ。
export const DELETE = withPosStaff('manager', async (_session, _req, ctx: RouteContext) => {
  const { id } = await ctx.params;
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();
  const { error } = await supabase.from('expense_categories').delete().eq('id', id).eq('store_id', storeId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
});
