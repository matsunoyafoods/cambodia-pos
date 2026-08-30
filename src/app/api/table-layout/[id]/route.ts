import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';

type RouteContext = { params: Promise<{ id: string }> };

const updateSchema = z.object({
  tableCode: z.string().trim().min(1).max(30).optional(),
  kind: z.enum(['table', 'pillar', 'counter', 'wall']).optional(),
  seats: z.number().int().min(0).max(50).optional(),
  x: z.number().int().optional(),
  y: z.number().int().optional(),
  width: z.number().int().min(24).max(600).optional(),
  height: z.number().int().min(24).max(600).optional(),
  sortOrder: z.number().int().optional(),
});

// 更新 (位置 / サイズ / 名前 / 種類 / 席数 / 並び順)。ドラッグ移動・リサイズも都度これを叩く。
// manager 以上のみ。
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
  if (parsed.data.tableCode !== undefined) patch.table_code = parsed.data.tableCode;
  if (parsed.data.kind !== undefined) patch.kind = parsed.data.kind;
  if (parsed.data.seats !== undefined) patch.seats = parsed.data.seats;
  if (parsed.data.x !== undefined) patch.x = parsed.data.x;
  if (parsed.data.y !== undefined) patch.y = parsed.data.y;
  if (parsed.data.width !== undefined) patch.width = parsed.data.width;
  if (parsed.data.height !== undefined) patch.height = parsed.data.height;
  if (parsed.data.sortOrder !== undefined) patch.sort_order = parsed.data.sortOrder;
  patch.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('table_layouts')
    .update(patch)
    .eq('id', id)
    .eq('store_id', storeId)
    .select('id, table_code, kind, seats, x, y, width, height, sort_order')
    .maybeSingle();

  if (error) {
    const status = error.code === '23505' ? 409 : 500;
    const message = status === 409 ? '同じ名前の卓・障害物が既に登録されています' : error.message;
    return NextResponse.json({ error: message }, { status });
  }
  if (!data) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return NextResponse.json({ item: data });
});

// 削除。manager 以上のみ。
export const DELETE = withPosStaff('manager', async (_session, _req, ctx: RouteContext) => {
  const { id } = await ctx.params;
  const storeId = getPosStoreId();
  const supabase = createPosAdminClient();

  const { error } = await supabase.from('table_layouts').delete().eq('id', id).eq('store_id', storeId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
});
