import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';

type RouteContext = { params: Promise<{ id: string }> };

// 指定した商品 (item) が自店舗のものであることを確認する。存在しない/他店舗なら null。
async function assertItemOwnership(supabase: ReturnType<typeof createPosAdminClient>, itemId: string, storeId: string) {
  const { data } = await supabase.from('menu_items').select('id').eq('id', itemId).eq('store_id', storeId).maybeSingle();
  return data;
}

// 商品オプション (トッピング・量目選択等) のグループ + 選択肢 一覧。manager 以上のみ。
export const GET = withPosStaff('manager', async (_session, _req, ctx: RouteContext) => {
  const { id: itemId } = await ctx.params;
  const storeId = getPosStoreId();
  const supabase = createPosAdminClient();

  const item = await assertItemOwnership(supabase, itemId, storeId);
  if (!item) {
    return NextResponse.json({ error: 'item_not_found' }, { status: 404 });
  }

  const { data: groups, error: groupsError } = await supabase
    .from('menu_option_groups')
    .select('id, key, label, required, sort_order')
    .eq('menu_id', itemId)
    .order('sort_order')
    .order('label');

  if (groupsError) {
    return NextResponse.json({ error: groupsError.message }, { status: 500 });
  }

  const groupIds = (groups ?? []).map((g) => g.id);
  let choices: { id: string; group_id: string; choice_key: string; label: string; price_delta: number; sort_order: number }[] = [];
  if (groupIds.length > 0) {
    const { data: choiceRows, error: choicesError } = await supabase
      .from('menu_option_choices')
      .select('id, group_id, choice_key, label, price_delta, sort_order')
      .in('group_id', groupIds)
      .order('sort_order')
      .order('label');
    if (choicesError) {
      return NextResponse.json({ error: choicesError.message }, { status: 500 });
    }
    choices = choiceRows ?? [];
  }

  const result = (groups ?? []).map((g) => ({
    ...g,
    choices: choices.filter((c) => c.group_id === g.id),
  }));

  return NextResponse.json({ groups: result });
});

const createGroupSchema = z.object({
  key: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(60),
  required: z.boolean().optional(),
});

// 新規オプショングループ作成 (例: 「量目を選択」)。並び順は末尾に自動追加。manager 以上のみ。
export const POST = withPosStaff('manager', async (_session, req, ctx: RouteContext) => {
  const { id: itemId } = await ctx.params;
  const json = await req.json().catch(() => null);
  const parsed = createGroupSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }

  const storeId = getPosStoreId();
  const supabase = createPosAdminClient();

  const item = await assertItemOwnership(supabase, itemId, storeId);
  if (!item) {
    return NextResponse.json({ error: 'item_not_found' }, { status: 404 });
  }

  const { data: existing, error: maxError } = await supabase
    .from('menu_option_groups')
    .select('sort_order')
    .eq('menu_id', itemId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (maxError) {
    return NextResponse.json({ error: maxError.message }, { status: 500 });
  }
  const nextSortOrder = (existing?.sort_order ?? -1) + 1;

  const { data, error } = await supabase
    .from('menu_option_groups')
    .insert({
      menu_id: itemId,
      key: parsed.data.key,
      label: parsed.data.label,
      required: parsed.data.required ?? true,
      sort_order: nextSortOrder,
    })
    .select('id, key, label, required, sort_order')
    .single();

  if (error) {
    const status = error.code === '23505' ? 409 : 500;
    const message = status === 409 ? '同じキーのオプショングループが既に登録されています' : error.message;
    return NextResponse.json({ error: message }, { status });
  }
  return NextResponse.json({ group: { ...data, choices: [] } }, { status: 201 });
});
