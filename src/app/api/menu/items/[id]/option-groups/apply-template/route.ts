import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';

type RouteContext = { params: Promise<{ id: string }> };

async function assertItemOwnership(supabase: ReturnType<typeof createPosAdminClient>, itemId: string, storeId: string) {
  const { data } = await supabase.from('menu_items').select('id').eq('id', itemId).eq('store_id', storeId).maybeSingle();
  return Boolean(data);
}

const applyTemplateSchema = z.object({
  templateId: z.string().uuid(),
});

// 保存済みのオプションテンプレート (例:「ライスorパン」) を商品に適用する。
// テンプレートの内容 (グループ + 選択肢) をコピーして、この商品専用の
// pos.menu_option_groups / pos.menu_option_choices の行として新規作成する
// (参照ではなくコピーなので、以後テンプレート側を編集しても既に適用済みの商品には影響しない)。
// manager 以上のみ。
export const POST = withPosStaff('manager', async (_session, req, ctx: RouteContext) => {
  const { id: itemId } = await ctx.params;
  const json = await req.json().catch(() => null);
  const parsed = applyTemplateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }

  const storeId = getPosStoreId();
  const supabase = createPosAdminClient();

  const itemOwned = await assertItemOwnership(supabase, itemId, storeId);
  if (!itemOwned) {
    return NextResponse.json({ error: 'item_not_found' }, { status: 404 });
  }

  const { data: template, error: templateError } = await supabase
    .from('menu_option_group_templates')
    .select('id, key, label, required')
    .eq('id', parsed.data.templateId)
    .eq('store_id', storeId)
    .maybeSingle();

  if (templateError) {
    return NextResponse.json({ error: templateError.message }, { status: 500 });
  }
  if (!template) {
    return NextResponse.json({ error: 'template_not_found' }, { status: 404 });
  }

  const { data: templateChoices, error: choicesError } = await supabase
    .from('menu_option_choice_templates')
    .select('choice_key, label, price_delta, sort_order')
    .eq('template_id', template.id)
    .order('sort_order')
    .order('label');

  if (choicesError) {
    return NextResponse.json({ error: choicesError.message }, { status: 500 });
  }

  const { data: existingGroup, error: maxError } = await supabase
    .from('menu_option_groups')
    .select('sort_order')
    .eq('menu_id', itemId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (maxError) {
    return NextResponse.json({ error: maxError.message }, { status: 500 });
  }
  const nextSortOrder = (existingGroup?.sort_order ?? -1) + 1;

  const { data: newGroup, error: groupError } = await supabase
    .from('menu_option_groups')
    .insert({
      menu_id: itemId,
      key: template.key,
      label: template.label,
      required: template.required,
      sort_order: nextSortOrder,
    })
    .select('id, key, label, required, sort_order')
    .single();

  if (groupError) {
    const status = groupError.code === '23505' ? 409 : 500;
    const message = status === 409 ? 'このオプション名は既にこの商品に登録されています' : groupError.message;
    return NextResponse.json({ error: message }, { status });
  }

  let insertedChoices: { id: string; group_id: string; choice_key: string; label: string; price_delta: number; sort_order: number }[] = [];
  if ((templateChoices ?? []).length > 0) {
    const { data: choiceRows, error: insertChoicesError } = await supabase
      .from('menu_option_choices')
      .insert(
        (templateChoices ?? []).map((c) => ({
          group_id: newGroup.id,
          choice_key: c.choice_key,
          label: c.label,
          price_delta: c.price_delta,
          sort_order: c.sort_order,
        })),
      )
      .select('id, group_id, choice_key, label, price_delta, sort_order');

    if (insertChoicesError) {
      // グループ自体は作成済みなので、選択肢のコピーだけ失敗した場合はグループを巻き戻す
      // (中途半端な空グループを残さないため)。
      await supabase.from('menu_option_groups').delete().eq('id', newGroup.id);
      return NextResponse.json({ error: insertChoicesError.message }, { status: 500 });
    }
    insertedChoices = choiceRows ?? [];
  }

  return NextResponse.json({ group: { ...newGroup, choices: insertedChoices } }, { status: 201 });
});
