import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';

// テーブルレイアウトの複数階 (フロア) 対応 (2026-11-06 追加)。
// フロア一覧は /api/table-layout (と公開版 /api/pos-order/table-layout) の GET が卓と一緒に返す。
// ここはフロアの新規追加のみ。manager 以上。

const FLOOR_SELECT = 'id, name, sort_order';

const createSchema = z.object({
  name: z.string().trim().min(1).max(30),
  // フロアがまだ1件も無い店舗で初めて階を追加するとき、既存の卓 (floor_id = null) を
  // まとめて入れる「最初の階」の名前。画面側の言語に合わせて渡す (例: 「1F」)。
  defaultFloorName: z.string().trim().min(1).max(30).optional(),
});

export const POST = withPosStaff('manager', async (_session, req) => {
  const json = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }

  const storeId = getPosStoreId();
  const supabase = createPosAdminClient();

  const { data: existing, error: listError } = await supabase
    .from('table_floors')
    .select('id, sort_order')
    .eq('store_id', storeId)
    .order('sort_order', { ascending: false });
  if (listError) {
    return NextResponse.json({ error: listError.message }, { status: 500 });
  }

  let defaultFloor: { id: string; name: string; sort_order: number } | null = null;
  let nextSortOrder = (existing?.[0]?.sort_order ?? -1) + 1;

  // 初めての階追加: これまでの1枚レイアウトを「最初の階」として登録し、既存の卓を全部そこへ入れる。
  if ((existing ?? []).length === 0) {
    const defaultName = parsed.data.defaultFloorName ?? '1F';
    if (defaultName === parsed.data.name) {
      return NextResponse.json({ error: '同じ名前の階が既に登録されています' }, { status: 409 });
    }
    const { data: created, error: createError } = await supabase
      .from('table_floors')
      .insert({ store_id: storeId, name: defaultName, sort_order: 0 })
      .select(FLOOR_SELECT)
      .single();
    if (createError) {
      return NextResponse.json({ error: createError.message }, { status: 500 });
    }
    defaultFloor = created;
    const { error: backfillError } = await supabase
      .from('table_layouts')
      .update({ floor_id: created.id, updated_at: new Date().toISOString() })
      .eq('store_id', storeId)
      .is('floor_id', null);
    if (backfillError) {
      return NextResponse.json({ error: backfillError.message }, { status: 500 });
    }
    nextSortOrder = 1;
  }

  const { data, error } = await supabase
    .from('table_floors')
    .insert({ store_id: storeId, name: parsed.data.name, sort_order: nextSortOrder })
    .select(FLOOR_SELECT)
    .single();

  if (error) {
    const status = error.code === '23505' ? 409 : 500;
    const message = status === 409 ? '同じ名前の階が既に登録されています' : error.message;
    return NextResponse.json({ error: message, defaultFloor }, { status });
  }
  return NextResponse.json({ floor: data, defaultFloor }, { status: 201 });
});
