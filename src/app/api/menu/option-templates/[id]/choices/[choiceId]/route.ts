import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';

type RouteContext = { params: Promise<{ id: string; choiceId: string }> };

// choice が templateId (= 自店舗のテンプレート) に属しているか確認する。
async function assertChoiceOwnership(
  supabase: ReturnType<typeof createPosAdminClient>,
  templateId: string,
  choiceId: string,
  storeId: string,
) {
  const { data: template } = await supabase
    .from('menu_option_group_templates')
    .select('id')
    .eq('id', templateId)
    .eq('store_id', storeId)
    .maybeSingle();
  if (!template) return false;
  const { data: choice } = await supabase
    .from('menu_option_choice_templates')
    .select('id')
    .eq('id', choiceId)
    .eq('template_id', templateId)
    .maybeSingle();
  return Boolean(choice);
}

const updateSchema = z.object({
  label: z.string().trim().min(1).max(60).optional(),
  priceDelta: z.number().optional(),
  sortOrder: z.number().int().optional(),
});

// テンプレート選択肢の更新 (表示名 / 価格差 / 並び順)。manager 以上のみ。
export const PATCH = withPosStaff('manager', async (_session, req, ctx: RouteContext) => {
  const { id: templateId, choiceId } = await ctx.params;
  const json = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(json);
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const storeId = getPosStoreId();
  const supabase = createPosAdminClient();

  const owned = await assertChoiceOwnership(supabase, templateId, choiceId, storeId);
  if (!owned) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.label !== undefined) patch.label = parsed.data.label;
  if (parsed.data.priceDelta !== undefined) patch.price_delta = parsed.data.priceDelta;
  if (parsed.data.sortOrder !== undefined) patch.sort_order = parsed.data.sortOrder;

  const { data, error } = await supabase
    .from('menu_option_choice_templates')
    .update(patch)
    .eq('id', choiceId)
    .select('id, template_id, choice_key, label, price_delta, sort_order')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return NextResponse.json({ choice: data });
});

// テンプレート選択肢の削除。manager 以上のみ。
export const DELETE = withPosStaff('manager', async (_session, _req, ctx: RouteContext) => {
  const { id: templateId, choiceId } = await ctx.params;
  const storeId = getPosStoreId();
  const supabase = createPosAdminClient();

  const owned = await assertChoiceOwnership(supabase, templateId, choiceId, storeId);
  if (!owned) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const { error } = await supabase.from('menu_option_choice_templates').delete().eq('id', choiceId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
});
