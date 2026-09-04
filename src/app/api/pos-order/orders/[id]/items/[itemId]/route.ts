import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { discountAmount, discountLabel, parseOrderItemDiscount, stripDiscountLabel } from '@/lib/cart';

type RouteContext = { params: Promise<{ id: string; itemId: string }> };

// discountType/discountValue が両方 undefined = 値引きには触れない (数量だけの更新)。
// 明示的に渡された場合 (null を含む) は値引きを設定・変更・解除する。
const patchSchema = z.object({
  discountType: z.enum(['percent', 'fixed']).nullable().optional(),
  discountValue: z.number().min(0).nullable().optional(),
  qty: z.number().int().min(1).optional(),
});

async function loadOpenOrder(supabase: ReturnType<typeof createPosAdminClient>, id: string, storeId: string) {
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('id, status')
    .eq('id', id)
    .eq('store_id', storeId)
    .maybeSingle();
  if (orderError) return { error: NextResponse.json({ error: orderError.message }, { status: 500 }) };
  if (!order) return { error: NextResponse.json({ error: 'not_found' }, { status: 404 }) };
  if (order.status !== 'open') {
    return { error: NextResponse.json({ error: 'この注文は既に会計済み・取消済みです' }, { status: 409 }) };
  }
  return { order };
}

// 確定済み (厨房送信済み) の注文品目を、後から編集する。
// - 値引きの設定・変更・解除 (2026-08-31 追加。「値引きは確定後も編集できるようにして欲しい」)
// - 数量の変更 (2026-08-31 追加。「カートに一度注文済みになると削除や変更ができません」)
// pos.order_items には値引き専用カラムが無く、confirmOrderItems と同じ方式
// (menu_name への角括弧ラベル付与 + line_total への反映) で表現しているため、再設定時は
// まず menu_name からラベルを取り除いて元の商品名を復元し、qty×unit_price (グロス額) から
// 値引き額を計算し直す。qty だけの更新の場合は、既存の値引き (menu_name のラベルから復元) を
// 維持したまま新しい数量で再計算する。
export async function PATCH(req: Request, ctx: RouteContext) {
  const { id, itemId } = await ctx.params;
  const json = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }
  const { discountType, discountValue, qty } = parsed.data;
  if (discountType && (discountValue == null || discountValue <= 0)) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  const touchesDiscount = discountType !== undefined || discountValue !== undefined;

  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const orderResult = await loadOpenOrder(supabase, id, storeId);
  if ('error' in orderResult) return orderResult.error;

  const { data: item, error: itemError } = await supabase
    .from('order_items')
    .select('id, menu_name, qty, unit_price')
    .eq('id', itemId)
    .eq('order_id', id)
    .maybeSingle();
  if (itemError) return NextResponse.json({ error: itemError.message }, { status: 500 });
  if (!item) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const baseName = stripDiscountLabel(item.menu_name);
  const effectiveQty = qty ?? item.qty;
  const existingDiscount = parseOrderItemDiscount(item.menu_name);
  const effectiveType = touchesDiscount ? (discountType ?? undefined) : existingDiscount?.type;
  const effectiveValue = touchesDiscount ? (discountValue ?? undefined) : existingDiscount?.value;

  const gross = item.unit_price * effectiveQty;
  const amount = discountAmount(gross, effectiveType, effectiveValue);
  const label = discountLabel(effectiveType, effectiveValue);
  const newLineTotal = Math.max(0, gross - amount);
  const newMenuName = label ? `${baseName} [${label}]` : baseName;

  const { data, error } = await supabase
    .from('order_items')
    .update({ menu_name: newMenuName, qty: effectiveQty, line_total: newLineTotal })
    .eq('id', itemId)
    .select('id, menu_id, menu_name, qty, unit_price, selected_options, line_total, sent_to_kitchen_at, kitchen_done_at, kitchen_done_by_name')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ item: data });
}

// 確定済みの注文品目を丸ごと削除する (数量を0にする = 取り消し)。
// 2026-08-31 追加。「カートに一度注文済みになると削除や変更ができません。できるようにして
// ください」
export async function DELETE(_req: Request, ctx: RouteContext) {
  const { id, itemId } = await ctx.params;
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const orderResult = await loadOpenOrder(supabase, id, storeId);
  if ('error' in orderResult) return orderResult.error;

  const { data, error } = await supabase
    .from('order_items')
    .delete()
    .eq('id', itemId)
    .eq('order_id', id)
    .select('id')
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
