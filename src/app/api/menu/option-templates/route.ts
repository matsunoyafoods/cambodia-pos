import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';

// 商品オプションの再利用可能テンプレート (例:「ライスorパン」「ドリンク選択」) 一覧 + 作成。
// 商品ごとの実データ (pos.menu_option_groups) とは別テーブル。詳細は
// 2026-08-31_add_menu_option_templates マイグレーションのコメントを参照。manager 以上のみ。
export const GET = withPosStaff('manager', async () => {
  const storeId = getPosStoreId();
  const supabase = createPosAdminClient();

  const { data: templates, error: templatesError } = await supabase
    .from('menu_option_group_templates')
    .select('id, key, label, required, sort_order, translations')
    .eq('store_id', storeId)
    .order('sort_order')
    .order('label');

  if (templatesError) {
    return NextResponse.json({ error: templatesError.message }, { status: 500 });
  }

  const templateIds = (templates ?? []).map((t) => t.id);
  let choices: {
    id: string;
    template_id: string;
    choice_key: string;
    label: string;
    price_delta: number;
    sort_order: number;
    translations: Record<string, string> | null;
  }[] = [];
  if (templateIds.length > 0) {
    const { data: choiceRows, error: choicesError } = await supabase
      .from('menu_option_choice_templates')
      .select('id, template_id, choice_key, label, price_delta, sort_order, translations')
      .in('template_id', templateIds)
      .order('sort_order')
      .order('label');
    if (choicesError) {
      return NextResponse.json({ error: choicesError.message }, { status: 500 });
    }
    choices = choiceRows ?? [];
  }

  const result = (templates ?? []).map((t) => ({
    ...t,
    choices: choices.filter((c) => c.template_id === t.id),
  }));

  return NextResponse.json({ templates: result });
});

const createTemplateSchema = z.object({
  key: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(60),
  required: z.boolean().optional(),
});

// 新規テンプレート作成。並び順は末尾に自動追加。manager 以上のみ。
export const POST = withPosStaff('manager', async (_session, req) => {
  const json = await req.json().catch(() => null);
  const parsed = createTemplateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }

  const storeId = getPosStoreId();
  const supabase = createPosAdminClient();

  const { data: existing, error: maxError } = await supabase
    .from('menu_option_group_templates')
    .select('sort_order')
    .eq('store_id', storeId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (maxError) {
    return NextResponse.json({ error: maxError.message }, { status: 500 });
  }
  const nextSortOrder = (existing?.sort_order ?? -1) + 1;

  const { data, error } = await supabase
    .from('menu_option_group_templates')
    .insert({
      store_id: storeId,
      key: parsed.data.key,
      label: parsed.data.label,
      required: parsed.data.required ?? true,
      sort_order: nextSortOrder,
    })
    .select('id, key, label, required, sort_order')
    .single();

  if (error) {
    const status = error.code === '23505' ? 409 : 500;
    const message = status === 409 ? '同じキーのテンプレートが既に登録されています' : error.message;
    return NextResponse.json({ error: message }, { status });
  }
  return NextResponse.json({ template: { ...data, choices: [] } }, { status: 201 });
});
