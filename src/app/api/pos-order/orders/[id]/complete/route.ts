import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';

type RouteContext = { params: Promise<{ id: string }> };

const postSchema = z.object({
  subtotal: z.number().min(0),
  vat: z.number().min(0),
  service: z.number().min(0),
  couponDiscount: z.number().min(0).default(0),
  orderDiscount: z.number().min(0).default(0),
  total: z.number().min(0),
  method: z.enum(['cash', 'qr', 'card']),
  amount: z.number().min(0),
  cashReceivedUsd: z.number().min(0).optional(),
  cashReceivedKhr: z.number().int().min(0).optional(),
  changeUsd: z.number().min(0).optional(),
  changeKhr: z.number().int().min(0).optional(),
});

// POST /api/pos-order/orders/[id]/complete : 会計完了。pos.orders を status='paid' にし、
// pos.payments に支払い記録を1件残す。認証なし (他の pos-order/* ルートと同じ理由)。
export async function POST(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const json = await req.json().catch(() => null);
  const parsed = postSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

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
  const { error: updateError } = await supabase
    .from('orders')
    .update({
      status: 'paid',
      subtotal: d.subtotal,
      vat: d.vat,
      service: d.service,
      coupon_discount: d.couponDiscount,
      order_discount: d.orderDiscount,
      total: d.total,
      paid_at: nowIso,
    })
    .eq('id', id);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  const { error: paymentError } = await supabase.from('payments').insert({
    order_id: id,
    method: d.method,
    amount: d.amount,
    cash_received_usd: d.cashReceivedUsd ?? null,
    cash_received_khr: d.cashReceivedKhr ?? null,
    change_usd: d.changeUsd ?? null,
    change_khr: d.changeKhr ?? null,
    confirmed_at: nowIso,
  });
  if (paymentError) return NextResponse.json({ error: paymentError.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
