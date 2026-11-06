import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';

type RouteContext = { params: Promise<{ id: string }> };

const updateSchema = z.object({
  name: z.string().trim().min(1).max(30).optional(),
  sortOrder: z.number().int().optional(),
});

// フロアの名前変更・並び順変更。manager 以上。
export const PATCH = withPosStaff('manager', async (_session, req, ctx: RouteContext) => {
  const { id } = await ctx.params;
  const json = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(json);
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const storeId = getPosStoreId();
  const supabase = createPosAdminClient();
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.sortOrder !== undefined) patch.sort_order = parsed.data.sortOrder;

  const { data, error } = await supabase
    .from('table_floors')
    .update(patch)
    .eq('id', id)
    .eq('store_id', storeId)
    .select('id, name, sort_order')
    .maybeSingle();

  if (error) {
    const status = error.code === '23505' ? 409 : 500;
    const message = status === 409 ? '同じ名前の階が既に登録されています' : error.message;
    return NextResponse.json({ error: message }, { status });
  }
  if (!data) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return NextResponse.json({ floor: data });
});

// フロア削除。卓・障害物が残っている階は削除できない (FK も restrict)。manager 以上。
export const DELETE = withPosStaff('manager', async (_session, _req, ctx: RouteContext) => {
  const { id } = await ctx.params;
  const storeId = getPosStoreId();
  const supabase = createPosAdminClient();

  const { count, error: countError } = await supabase
    .from('table_layouts')
    .select('id', { count: 'exact', head: true })
    .eq('store_id', storeId)
    .eq('floor_id', id);
  if (countError) {
    return NextResponse.json({ error: countError.message }, { status: 500 });
  }
  if ((count ?? 0) > 0) {
    return NextResponse.json({ error: 'この階には卓・障害物が残っています。先に削除するか別の階へ移動してください' }, { status: 409 });
  }

  const { error } = await supabase.from('table_floors').delete().eq('id', id).eq('store_id', storeId);
  if (error) {
    const status = error.code === '23503' ? 409 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
  return NextResponse.json({ ok: true });
});
