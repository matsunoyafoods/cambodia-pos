import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';

// テーブルレイアウト (卓 + 柱・カウンター等の障害物) 一覧。
// register 画面 (テーブルマップ) からも参照するので staff 以上 (全スタッフ) で許可する。
export const GET = withPosStaff('part_time', async () => {
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data, error } = await supabase
    .from('table_layouts')
    .select('id, table_code, kind, seats, x, y, width, height, sort_order, floor_id')
    .eq('store_id', storeId)
    .order('sort_order')
    .order('table_code');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const { data: floors, error: floorsError } = await supabase
    .from('table_floors')
    .select('id, name, sort_order')
    .eq('store_id', storeId)
    .order('sort_order')
    .order('name');
  if (floorsError) {
    return NextResponse.json({ error: floorsError.message }, { status: 500 });
  }
  return NextResponse.json({ items: data ?? [], floors: floors ?? [] });
});

const createSchema = z.object({
  tableCode: z.string().trim().min(1).max(30),
  kind: z.enum(['table', 'pillar', 'counter', 'wall']).optional(),
  seats: z.number().int().min(0).max(50).optional(),
  x: z.number().int().optional(),
  y: z.number().int().optional(),
  width: z.number().int().min(24).max(600).optional(),
  height: z.number().int().min(24).max(600).optional(),
  // 複数階対応 (2026-11-06)。null / 省略 = 先頭の階 (階が無い店舗は従来の1枚レイアウト)。
  floorId: z.string().uuid().nullable().optional(),
});

// floorId が指定された場合、その階がこの店舗のものか確認する (他店舗の階への紐付けを防ぐ)。
async function floorBelongsToStore(
  supabase: ReturnType<typeof createPosAdminClient>,
  storeId: string,
  floorId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('table_floors')
    .select('id')
    .eq('id', floorId)
    .eq('store_id', storeId)
    .maybeSingle();
  return !!data;
}

// 新規追加 (卓 または 障害物)。並び順は末尾に自動追加。manager 以上のみ。
export const POST = withPosStaff('manager', async (_session, req) => {
  const json = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }

  const storeId = getPosStoreId();
  const supabase = createPosAdminClient();

  if (parsed.data.floorId && !(await floorBelongsToStore(supabase, storeId, parsed.data.floorId))) {
    return NextResponse.json({ error: 'invalid_floor' }, { status: 400 });
  }

  const { data: existing, error: maxError } = await supabase
    .from('table_layouts')
    .select('sort_order')
    .eq('store_id', storeId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (maxError) {
    return NextResponse.json({ error: maxError.message }, { status: 500 });
  }
  const nextSortOrder = (existing?.sort_order ?? -1) + 1;
  const kind = parsed.data.kind ?? 'table';

  const { data, error } = await supabase
    .from('table_layouts')
    .insert({
      store_id: storeId,
      table_code: parsed.data.tableCode,
      kind,
      seats: parsed.data.seats ?? (kind === 'table' ? 4 : 0),
      x: parsed.data.x ?? 24,
      y: parsed.data.y ?? 24,
      width: parsed.data.width ?? (kind === 'table' ? 84 : kind === 'pillar' ? 32 : 160),
      height: parsed.data.height ?? (kind === 'table' ? 64 : kind === 'pillar' ? 32 : 40),
      sort_order: nextSortOrder,
      floor_id: parsed.data.floorId ?? null,
    })
    .select('id, table_code, kind, seats, x, y, width, height, sort_order, floor_id')
    .single();

  if (error) {
    const status = error.code === '23505' ? 409 : 500;
    const message = status === 409 ? '同じ名前の卓・障害物が既に登録されています' : error.message;
    return NextResponse.json({ error: message }, { status });
  }
  return NextResponse.json({ item: data }, { status: 201 });
});
