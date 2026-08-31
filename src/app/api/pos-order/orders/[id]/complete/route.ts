import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';

type RouteContext = { params: Promise<{ id: string }> };

// 会計の1つの支払いライン。分割払い (ABA $10 + 現金$10) や割り勘 (人数で分けて個別に会計) に
// 対応するため、1回の会計完了で複数の支払いラインをまとめて受け取れるようにした
// (2026-08-31 追加)。pos.payments は元々 order_id に対して複数行を許容する設計だったので、
// テーブル自体のマイグレーションは不要 — ここでは insert を配列分ループするだけでよい。
// method は以前は 'cash'|'qr'|'card' 固定だったが、店舗が自由に決済方法を追加できるように
// なったため (2026-08-31 変更。pos.payment_methods 参照)、その時点の表示名の自由文字列を
// そのまま受け取る (pos.payments.method に同じ文字列をスナップショットとして保存する)。
const paymentLineSchema = z.object({
  method: z.string().trim().min(1),
  amount: z.number().min(0),
  cashReceivedUsd: z.number().min(0).optional(),
  cashReceivedKhr: z.number().int().min(0).optional(),
  changeUsd: z.number().min(0).optional(),
  changeKhr: z.number().int().min(0).optional(),
});

const postSchema = z.object({
  subtotal: z.number().min(0),
  vat: z.number().min(0),
  service: z.number().min(0),
  couponDiscount: z.number().min(0).default(0),
  orderDiscount: z.number().min(0).default(0),
  total: z.number().min(0),
  payments: z.array(paymentLineSchema).min(1),
});

// POST /api/pos-order/orders/[id]/complete : 会計完了。pos.orders を status='paid' にし、
// pos.payments に支払い記録を (分割払い・割り勘の場合は複数件) 残す。認証なし (他の
// pos-order/* ルートと同じ理由)。
export async function POST(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const json = await req.json().catch(() => null);
  const parsed = postSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const paidTotal = d.payments.reduce((s, p) => s + p.amount, 0);
  // 端数の丸め誤差を許容 (1セント未満)。それ以上の不足は会計を完了させない。
  if (paidTotal < d.total - 0.01) {
    return NextResponse.json(
      { error: `支払い金額の合計 ($${paidTotal.toFixed(2)}) が会計金額 ($${d.total.toFixed(2)}) に足りません` },
      { status: 400 },
    );
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

  const { error: paymentError } = await supabase.from('payments').insert(
    d.payments.map((p) => ({
      order_id: id,
      method: p.method,
      amount: p.amount,
      cash_received_usd: p.cashReceivedUsd ?? null,
      cash_received_khr: p.cashReceivedKhr ?? null,
      change_usd: p.changeUsd ?? null,
      change_khr: p.changeKhr ?? null,
      confirmed_at: nowIso,
    })),
  );
  if (paymentError) return NextResponse.json({ error: paymentError.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
