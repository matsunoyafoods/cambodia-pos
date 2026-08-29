import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';

type RouteContext = { params: Promise<{ id: string }> };

const updateSchema = z.object({
  name: z.string().trim().min(1).max(50).optional(),
  sortOrder: z.number().int().optional(),
});

// カテゴリ更新 (名前 / 並び順)。manager 以上のみ。
export const PATCH = withPosStaff('manager', async (_session, req, ctx: RouteContext) => {
  const { id } = await ctx.params;
  const json = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(json);
  if (!parsed.success || (!parsed.data.name && parsed.data.sortOrder === undefined)) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const storeId = getPosStoreId();
  const supabase = createPosAdminClient();
  const patch: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.sortOrder !== undefined) patch.sort_order = parsed.data.sortOrder;

  const { data, error } = await supabase
    .from('menu_categories')
    .update(patch)
    .eq('id', id)
    .eq('store_id', storeId)
    .select('id, name, sort_order')
    .maybeSingle();

  if (error) {
    const status = error.code === '23505' ? 409 : 500;
    const message = status === 409 ? '同じ名前のカテゴリが既に登録されています' : error.message;
    return NextResponse.json({ error: message }, { status });
  }
  if (!data) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return NextResponse.json({ category: data });
});

// カテゴリ削除。所属していた商品は「未分類」扱いになる (category_id が null になるだけ、商品自体は消えない)。
export const DELETE = withPosStaff('manager', async (_session, _req, ctx: RouteContext) => {
  const { id } = await ctx.params;
  const storeId = getPosStoreId();
  const supabase = createPosAdminClient();

  const { error } = await supabase.from('menu_categories').delete().eq('id', id).eq('store_id', storeId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
});
