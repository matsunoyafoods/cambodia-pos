import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';
import { indexCategories, categoryDepth, type CategoryNode } from '@/lib/category-tree';

type RouteContext = { params: Promise<{ id: string }> };

const updateSchema = z.object({
  name: z.string().trim().min(1).max(50).optional(),
  sortOrder: z.number().int().optional(),
  // 親カテゴリーの付け替え。null = 大カテゴリーに昇格。
  parentId: z.string().uuid().nullable().optional(),
});

// カテゴリ更新 (名前 / 並び順 / 親カテゴリーの付け替え)。manager 以上のみ。
export const PATCH = withPosStaff('manager', async (_session, req, ctx: RouteContext) => {
  const { id } = await ctx.params;
  const json = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(json);
  if (!parsed.success || (parsed.data.name === undefined && parsed.data.sortOrder === undefined && parsed.data.parentId === undefined)) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const storeId = getPosStoreId();
  const supabase = createPosAdminClient();
  const patch: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.sortOrder !== undefined) patch.sort_order = parsed.data.sortOrder;

  if (parsed.data.parentId !== undefined) {
    const newParentId = parsed.data.parentId;
    if (newParentId === id) {
      return NextResponse.json({ error: '自分自身を親カテゴリーにはできません' }, { status: 400 });
    }
    if (newParentId !== null) {
      const { data: all, error: allError } = await supabase
        .from('menu_categories')
        .select('id, name, sort_order, parent_id')
        .eq('store_id', storeId);
      if (allError) return NextResponse.json({ error: allError.message }, { status: 500 });

      const byId = indexCategories((all ?? []) as CategoryNode[]);
      if (!byId.has(newParentId)) {
        return NextResponse.json({ error: '親カテゴリーが見つかりません' }, { status: 400 });
      }
      // 循環防止: 新しい親が、このカテゴリの子孫でないことを確認する。
      let cursor: string | null = newParentId;
      while (cursor) {
        if (cursor === id) {
          return NextResponse.json({ error: '自分の子孫を親カテゴリーにはできません' }, { status: 400 });
        }
        cursor = byId.get(cursor)?.parent_id ?? null;
      }
      // 2026-08-31: 小カテゴリーを廃止し、深さは大(0)→中(1) の最大2階層までに制限した。
      const parentDepth = categoryDepth(newParentId, byId);
      if (parentDepth === null || parentDepth >= 1) {
        return NextResponse.json({ error: 'これ以上深い階層のカテゴリーは作成できません (大→中の2階層まで)' }, { status: 400 });
      }
      // 子カテゴリー (中カテゴリー) を持つカテゴリーを別のカテゴリーの下に移動すると、
      // その子が3階層目になってしまうため禁止する (大カテゴリーとして独立させることのみ許可)。
      const hasChildren = (all ?? []).some((c) => c.parent_id === id);
      if (hasChildren) {
        return NextResponse.json(
          { error: '中カテゴリーを持つカテゴリーは、他のカテゴリーの下には移動できません' },
          { status: 400 },
        );
      }
    }
    patch.parent_id = newParentId;
  }

  const { data, error } = await supabase
    .from('menu_categories')
    .update(patch)
    .eq('id', id)
    .eq('store_id', storeId)
    .select('id, name, sort_order, parent_id')
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
// 子カテゴリーがあった場合は親を1階層上に昇格させる (ON DELETE SET NULL、消えない)。
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
