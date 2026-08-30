import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';
import { indexCategories, categoryDepth, type CategoryNode } from '@/lib/category-tree';

// カテゴリ一覧 (大/中/小 階層をフラットな parent_id 付きレコードで返す)。manager 以上のみ。
export const GET = withPosStaff('manager', async () => {
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data, error } = await supabase
    .from('menu_categories')
    .select('id, name, sort_order, parent_id')
    .eq('store_id', storeId)
    .order('sort_order')
    .order('name');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ categories: data ?? [] });
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(50),
  // 省略/null = 大カテゴリーとして作成。指定時はその下に中or小カテゴリーとして作成 (深さは自動判定)。
  parentId: z.string().uuid().nullable().optional(),
});

// 新規カテゴリ作成。並び順は同じ親を持つカテゴリの中で末尾に自動追加。manager 以上のみ。
// 深さは大(0)→中/小(1)→小(2) の最大3階層まで。それ以上深い parentId は拒否する。
export const POST = withPosStaff('manager', async (_session, req) => {
  const json = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }
  const parentId = parsed.data.parentId ?? null;

  const storeId = getPosStoreId();
  const supabase = createPosAdminClient();

  if (parentId) {
    const { data: all, error: allError } = await supabase
      .from('menu_categories')
      .select('id, name, sort_order, parent_id')
      .eq('store_id', storeId);
    if (allError) return NextResponse.json({ error: allError.message }, { status: 500 });

    const byId = indexCategories((all ?? []) as CategoryNode[]);
    if (!byId.has(parentId)) {
      return NextResponse.json({ error: '親カテゴリーが見つかりません' }, { status: 400 });
    }
    const parentDepth = categoryDepth(parentId, byId);
    if (parentDepth === null || parentDepth >= 2) {
      return NextResponse.json({ error: 'これ以上深い階層のカテゴリーは作成できません (大→中→小の3階層まで)' }, { status: 400 });
    }
  }

  // 同じ親を持つカテゴリの中で末尾の並び順を調べる (parent_id が null の場合は .is() で拾う必要がある)。
  let siblingsQuery = supabase
    .from('menu_categories')
    .select('sort_order')
    .eq('store_id', storeId)
    .order('sort_order', { ascending: false })
    .limit(1);
  siblingsQuery = parentId === null ? siblingsQuery.is('parent_id', null) : siblingsQuery.eq('parent_id', parentId);
  const { data: existing, error: maxError } = await siblingsQuery.maybeSingle();
  if (maxError) return NextResponse.json({ error: maxError.message }, { status: 500 });
  const nextSortOrder = (existing?.sort_order ?? -1) + 1;

  const { data, error } = await supabase
    .from('menu_categories')
    .insert({ store_id: storeId, name: parsed.data.name, sort_order: nextSortOrder, parent_id: parentId })
    .select('id, name, sort_order, parent_id')
    .single();

  if (error) {
    const status = error.code === '23505' ? 409 : 500;
    const message = status === 409 ? '同じ名前のカテゴリが既に登録されています' : error.message;
    return NextResponse.json({ error: message }, { status });
  }
  return NextResponse.json({ category: data }, { status: 201 });
});
