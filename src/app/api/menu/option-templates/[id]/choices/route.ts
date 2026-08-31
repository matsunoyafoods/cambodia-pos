import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';

type RouteContext = { params: Promise<{ id: string }> };

async function assertTemplateOwnership(supabase: ReturnType<typeof createPosAdminClient>, templateId: string, storeId: string) {
  const { data } = await supabase
    .from('menu_option_group_templates')
    .select('id')
    .eq('id', templateId)
    .eq('store_id', storeId)
    .maybeSingle();
  return Boolean(data);
}

const createChoiceSchema = z.object({
  choiceKey: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(60),
  priceDelta: z.number().optional(),
});

// テンプレートへの新規選択肢作成 (例:「ライス」「パン (+$0.50)」)。並び順は末尾に自動追加。manager 以上のみ。
export const POST = withPosStaff('manager', async (_session, req, ctx: RouteContext) => {
  const { id: templateId } = await ctx.params;
  const json = await req.json().catch(() => null);
  const parsed = createChoiceSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }

  const storeId = getPosStoreId();
  const supabase = createPosAdminClient();

  const owned = await assertTemplateOwnership(supabase, templateId, storeId);
  if (!owned) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const { data: existing, error: maxError } = await supabase
    .from('menu_option_choice_templates')
    .select('sort_order')
    .eq('template_id', templateId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (maxError) {
    return NextResponse.json({ error: maxError.message }, { status: 500 });
  }
  const nextSortOrder = (existing?.sort_order ?? -1) + 1;

  const { data, error } = await supabase
    .from('menu_option_choice_templates')
    .insert({
      template_id: templateId,
      choice_key: parsed.data.choiceKey,
      label: parsed.data.label,
      price_delta: parsed.data.priceDelta ?? 0,
      sort_order: nextSortOrder,
    })
    .select('id, template_id, choice_key, label, price_delta, sort_order')
    .single();

  if (error) {
    const status = error.code === '23505' ? 409 : 500;
    const message = status === 409 ? '同じキーの選択肢が既に登録されています' : error.message;
    return NextResponse.json({ error: message }, { status });
  }
  return NextResponse.json({ choice: data }, { status: 201 });
});
