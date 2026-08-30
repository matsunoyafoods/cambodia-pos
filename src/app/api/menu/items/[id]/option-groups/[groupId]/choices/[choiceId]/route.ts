import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';

type RouteContext = { params: Promise<{ id: string; groupId: string; choiceId: string }> };

// choice が groupId → itemId (= 自店舗の商品) の経路で正しく属しているか確認する。
async function assertChoiceOwnership(
  supabase: ReturnType<typeof createPosAdminClient>,
  itemId: string,
  groupId: string,
  choiceId: string,
  storeId: string,
) {
  const { data: item } = await supabase.from('menu_items').select('id').eq('id', itemId).eq('store_id', storeId).maybeSingle();
  if (!item) return false;
  const { data: group } = await supabase.from('menu_option_groups').select('id').eq('id', groupId).eq('menu_id', itemId).maybeSingle();
  if (!group) return false;
  const { data: choice } = await supabase
    .from('menu_option_choices')
    .select('id')
    .eq('id', choiceId)
    .eq('group_id', groupId)
    .maybeSingle();
  return Boolean(choice);
}

const updateSchema = z.object({
  label: z.string().trim().min(1).max(60).optional(),
  priceDelta: z.number().optional(),
  sortOrder: z.number().int().optional(),
});

// 選択肢更新 (表示名 / 追加料金 / 並び順)。manager 以上のみ。
export const PATCH = withPosStaff('manager', async (_session, req, ctx: RouteContext) => {
  const { id: itemId, groupId, choiceId } = await ctx.params;
  const json = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(json);
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const storeId = getPosStoreId();
  const supabase = createPosAdminClient();

  const owned = await assertChoiceOwnership(supabase, itemId, groupId, choiceId, storeId);
  if (!owned) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.label !== undefined) patch.label = parsed.data.label;
  if (parsed.data.priceDelta !== undefined) patch.price_delta = parsed.data.priceDelta;
  if (parsed.data.sortOrder !== undefined) patch.sort_order = parsed.data.sortOrder;

  const { data, error } = await supabase
    .from('menu_option_choices')
    .update(patch)
    .eq('id', choiceId)
    .select('id, group_id, choice_key, label, price_delta, sort_order')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return NextResponse.json({ choice: data });
});

// 選択肢削除。manager 以上のみ。
export const DELETE = withPosStaff('manager', async (_session, _req, ctx: RouteContext) => {
  const { id: itemId, groupId, choiceId } = await ctx.params;
  const storeId = getPosStoreId();
  const supabase = createPosAdminClient();

  const owned = await assertChoiceOwnership(supabase, itemId, groupId, choiceId, storeId);
  if (!owned) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const { error } = await supabase.from('menu_option_choices').delete().eq('id', choiceId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
});
