import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';

type RouteContext = { params: Promise<{ id: string; groupId: string }> };

// group が itemId (= 自店舗の商品) に属しているか確認する。
async function assertGroupOwnership(
  supabase: ReturnType<typeof createPosAdminClient>,
  itemId: string,
  groupId: string,
  storeId: string,
) {
  const { data: item } = await supabase.from('menu_items').select('id').eq('id', itemId).eq('store_id', storeId).maybeSingle();
  if (!item) return false;
  const { data: group } = await supabase.from('menu_option_groups').select('id').eq('id', groupId).eq('menu_id', itemId).maybeSingle();
  return Boolean(group);
}

const createChoiceSchema = z.object({
  choiceKey: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(60),
  priceDelta: z.number().optional(),
});

// 新規選択肢作成 (例: 「100g」「+$1.00」)。並び順はグループ内末尾に自動追加。manager 以上のみ。
export const POST = withPosStaff('manager', async (_session, req, ctx: RouteContext) => {
  const { id: itemId, groupId } = await ctx.params;
  const json = await req.json().catch(() => null);
  const parsed = createChoiceSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }

  const storeId = getPosStoreId();
  const supabase = createPosAdminClient();

  const owned = await assertGroupOwnership(supabase, itemId, groupId, storeId);
  if (!owned) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const { data: existing, error: maxError } = await supabase
    .from('menu_option_choices')
    .select('sort_order')
    .eq('group_id', groupId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (maxError) {
    return NextResponse.json({ error: maxError.message }, { status: 500 });
  }
  const nextSortOrder = (existing?.sort_order ?? -1) + 1;

  const { data, error } = await supabase
    .from('menu_option_choices')
    .insert({
      group_id: groupId,
      choice_key: parsed.data.choiceKey,
      label: parsed.data.label,
      price_delta: parsed.data.priceDelta ?? 0,
      sort_order: nextSortOrder,
    })
    .select('id, group_id, choice_key, label, price_delta, sort_order')
    .single();

  if (error) {
    const status = error.code === '23505' ? 409 : 500;
    const message = status === 409 ? '同じキーの選択肢が既に登録されています' : error.message;
    return NextResponse.json({ error: message }, { status });
  }
  return NextResponse.json({ choice: data }, { status: 201 });
});
