import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';
import type { PaymentMethodConfig } from '@/lib/pos-types';

type RouteContext = { params: Promise<{ id: string }> };

function toConfig(row: {
  id: string;
  name: string;
  is_cash: boolean;
  enabled: boolean;
  sort_order: number;
}): PaymentMethodConfig {
  return { id: row.id, name: row.name, isCash: row.is_cash, enabled: row.enabled, sortOrder: row.sort_order };
}

const patchSchema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  isCash: z.boolean().optional(),
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

// 名称変更・現金フラグ変更・有効/無効切り替え・並び替え。manager 以上のみ。
// 削除ではなく enabled:false にする運用も可 (削除しても pos.payments 側は当時の名称を
// スナップショットで持っているので、履歴・レシートには影響しない)。
export const PATCH = withPosStaff('manager', async (_session, req, ctx: RouteContext) => {
  const { id } = await ctx.params;
  const json = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.isCash !== undefined) patch.is_cash = parsed.data.isCash;
  if (parsed.data.enabled !== undefined) patch.enabled = parsed.data.enabled;
  if (parsed.data.sortOrder !== undefined) patch.sort_order = parsed.data.sortOrder;

  const { data, error } = await supabase
    .from('payment_methods')
    .update(patch)
    .eq('id', id)
    .eq('store_id', storeId)
    .select('id, name, is_cash, enabled, sort_order')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ paymentMethod: toConfig(data) });
});

// 削除。manager 以上のみ。
export const DELETE = withPosStaff('manager', async (_session, _req, ctx: RouteContext) => {
  const { id } = await ctx.params;
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();
  const { error } = await supabase.from('payment_methods').delete().eq('id', id).eq('store_id', storeId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
});
