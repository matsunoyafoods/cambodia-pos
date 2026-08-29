import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';

type RouteContext = { params: Promise<{ id: string }> };

const updateSchema = z.object({
  categoryId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(80).optional(),
  price: z.number().nonnegative().optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

// 商品更新 (名前 / 価格 / カテゴリ / 販売中フラグ / 並び順)。manager 以上のみ。
export const PATCH = withPosStaff('manager', async (_session, req, ctx: RouteContext) => {
  const { id } = await ctx.params;
  const json = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(json);
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const storeId = getPosStoreId();
  const supabase = createPosAdminClient();
  const patch: Record<string, unknown> = {};
  if (parsed.data.categoryId !== undefined) patch.category_id = parsed.data.categoryId;
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.price !== undefined) patch.price = parsed.data.price;
  if (parsed.data.active !== undefined) patch.active = parsed.data.active;
  if (parsed.data.sortOrder !== undefined) patch.sort_order = parsed.data.sortOrder;
  patch.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('menu_items')
    .update(patch)
    .eq('id', id)
    .eq('store_id', storeId)
    .select('id, category_id, name, price, active, sort_order')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return NextResponse.json({ item: data });
});

// 商品削除 (紐づく商品オプションも cascade で削除される)。manager 以上のみ。
export const DELETE = withPosStaff('manager', async (_session, _req, ctx: RouteContext) => {
  const { id } = await ctx.params;
  const storeId = getPosStoreId();
  const supabase = createPosAdminClient();

  const { error } = await supabase.from('menu_items').delete().eq('id', id).eq('store_id', storeId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
});
