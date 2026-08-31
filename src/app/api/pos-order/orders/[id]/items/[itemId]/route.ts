import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { discountAmount, discountLabel, stripDiscountLabel } from '@/lib/cart';

type RouteContext = { params: Promise<{ id: string; itemId: string }> };

const patchSchema = z.object({
  discountType: z.enum(['percent', 'fixed']).nullable(),
  discountValue: z.number().min(0).nullable(),
});

// 確定済み (厨房送信済み) の注文品目に、後から急遽の値引きを設定・変更・解除する
// (2026-08-31 追加。「値引きは確定後も編集できるようにして欲しい」)。
// pos.order_items には値引き専用カラムが無く、confirmOrderItems と同じ方式
// (menu_name への角括弧ラベル付与 + line_total への反映) で表現しているため、再設定時は
// まず menu_name からラベルを取り除いて元の商品名を復元し、qty×unit_price (グロス額) から
// 新しい値引き額を計算し直す。
export async function PATCH(req: Request, ctx: RouteContext) {
  const { id, itemId } = await ctx.params;
  const json = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }
  const { discountType, discountValue } = parsed.data;
  if (discountType && (discountValue == null || discountValue <= 0)) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('id, status')
    .eq('id', id)
    .eq('store_id', storeId)
    .maybeSingle();
  if (orderError) return NextResponse.json({ error: orderError.message }, { status: 500 });
  if (!order) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (order.status !== 'open') {
    return NextResponse.json({ error: 'この注文は既に会計済み・取消済みです' }, { status: 409 });
  }

  const { data: item, error: itemError } = await supabase
    .from('order_items')
    .select('id, menu_name, qty, unit_price')
    .eq('id', itemId)
    .eq('order_id', id)
    .maybeSingle();
  if (itemError) return NextResponse.json({ error: itemError.message }, { status: 500 });
  if (!item) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const baseName = stripDiscountLabel(item.menu_name);
  const gross = item.unit_price * item.qty;
  const amount = discountAmount(gross, discountType ?? undefined, discountValue ?? undefined);
  const label = discountLabel(discountType ?? undefined, discountValue ?? undefined);
  const newLineTotal = Math.max(0, gross - amount);
  const newMenuName = label ? `${baseName} [${label}]` : baseName;

  const { data, error } = await supabase
    .from('order_items')
    .update({ menu_name: newMenuName, line_total: newLineTotal })
    .eq('id', itemId)
    .select('id, menu_id, menu_name, qty, unit_price, selected_options, line_total, sent_to_kitchen_at')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ item: data });
}
