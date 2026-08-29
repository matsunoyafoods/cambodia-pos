import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';

// 商品一覧 (カテゴリ横断・全件)。manager 以上のみ。
export const GET = withPosStaff('manager', async () => {
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data, error } = await supabase
    .from('menu_items')
    .select('id, category_id, name, price, active, sort_order')
    .eq('store_id', storeId)
    .order('sort_order')
    .order('name');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ items: data ?? [] });
});

const createSchema = z.object({
  categoryId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(80),
  price: z.number().nonnegative(),
});

// 新規商品登録。並び順は同一カテゴリ内の末尾に自動追加。manager 以上のみ。
export const POST = withPosStaff('manager', async (_session, req) => {
  const json = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }

  const storeId = getPosStoreId();
  const categoryId = parsed.data.categoryId ?? null;
  const supabase = createPosAdminClient();

  let existingQuery = supabase
    .from('menu_items')
    .select('sort_order')
    .eq('store_id', storeId)
    .order('sort_order', { ascending: false })
    .limit(1);
  existingQuery = categoryId ? existingQuery.eq('category_id', categoryId) : existingQuery.is('category_id', null);
  const { data: existing, error: maxError } = await existingQuery.maybeSingle();

  if (maxError) {
    return NextResponse.json({ error: maxError.message }, { status: 500 });
  }
  const nextSortOrder = (existing?.sort_order ?? -1) + 1;

  const { data, error } = await supabase
    .from('menu_items')
    .insert({
      store_id: storeId,
      category_id: categoryId,
      name: parsed.data.name,
      price: parsed.data.price,
      sort_order: nextSortOrder,
    })
    .select('id, category_id, name, price, active, sort_order')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ item: data }, { status: 201 });
});
