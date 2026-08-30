import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';

type RouteContext = { params: Promise<{ id: string }> };

const selectedOptionSchema = z.object({
  groupKey: z.string(),
  groupLabel: z.string(),
  choiceId: z.string(),
  choiceLabel: z.string(),
  priceDelta: z.number(),
});

const itemSchema = z.object({
  menuId: z.string(),
  menuName: z.string().min(1),
  qty: z.number().int().positive(),
  unitPrice: z.number().min(0),
  selectedOptions: z.array(selectedOptionSchema).default([]),
  lineTotal: z.number().min(0),
});

const postSchema = z.object({
  items: z.array(itemSchema).min(1),
});

// POST /api/pos-order/orders/[id]/items : 「注文確定」= カートの品目を厨房送信済みとして
// この open 注文に追記する (pos.order_items.sent_to_kitchen_at = now)。認証なし (他の
// pos-order/* ルートと同じ理由)。レジ画面はこの呼び出しの成功後にローカルのカートを空にする。
export async function POST(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const json = await req.json().catch(() => null);
  const parsed = postSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
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

  const nowIso = new Date().toISOString();
  const rows = parsed.data.items.map((it) => ({
    order_id: id,
    menu_id: it.menuId,
    menu_name: it.menuName,
    qty: it.qty,
    unit_price: it.unitPrice,
    selected_options: it.selectedOptions,
    line_total: it.lineTotal,
    sent_to_kitchen_at: nowIso,
  }));

  const { data, error } = await supabase
    .from('order_items')
    .insert(rows)
    .select('id, menu_id, menu_name, qty, unit_price, selected_options, line_total, sent_to_kitchen_at');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] }, { status: 201 });
}
