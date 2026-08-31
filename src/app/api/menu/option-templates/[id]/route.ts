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

const updateSchema = z.object({
  label: z.string().trim().min(1).max(60).optional(),
  required: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

// テンプレート更新 (表示名 / 必須フラグ / 並び順)。既に適用済みの商品側には影響しない。manager 以上のみ。
export const PATCH = withPosStaff('manager', async (_session, req, ctx: RouteContext) => {
  const { id: templateId } = await ctx.params;
  const json = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(json);
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const storeId = getPosStoreId();
  const supabase = createPosAdminClient();

  const owned = await assertTemplateOwnership(supabase, templateId, storeId);
  if (!owned) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.label !== undefined) patch.label = parsed.data.label;
  if (parsed.data.required !== undefined) patch.required = parsed.data.required;
  if (parsed.data.sortOrder !== undefined) patch.sort_order = parsed.data.sortOrder;

  const { data, error } = await supabase
    .from('menu_option_group_templates')
    .update(patch)
    .eq('id', templateId)
    .select('id, key, label, required, sort_order')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return NextResponse.json({ template: data });
});

// テンプレート削除 (紐づく選択肢も cascade で削除される)。既に適用済みの商品側には影響しない。manager 以上のみ。
export const DELETE = withPosStaff('manager', async (_session, _req, ctx: RouteContext) => {
  const { id: templateId } = await ctx.params;
  const storeId = getPosStoreId();
  const supabase = createPosAdminClient();

  const owned = await assertTemplateOwnership(supabase, templateId, storeId);
  if (!owned) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const { error } = await supabase.from('menu_option_group_templates').delete().eq('id', templateId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
});
