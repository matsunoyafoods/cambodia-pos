import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { DEFAULT_SETTINGS } from '@/lib/pos-types';

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/pos-order/orders/[id]/request-paper-receipt : お客様が「紙でレシートが欲しい」
// と言った場合の、ハンディ発の会計確定 (2026-10-07 追加)。
//
// プリンターがPassPRNT (レジ端末とBluetoothペアリング) のため、ハンディ自身はプリンターに
// 印刷命令を送れない。ここでは「現金で会計完了」までをサーバー側で行い、
// pos.orders.print_requested_at を立てるだけにする。実際に印刷命令 (PassPRNT URLスキーム)
// を送るのはレジ画面側 — table-billing-status のポーリングでこのフラグを見つけたら
// バナーを出し、スタッフの1タップでレジ端末自身のブラウザから送信する (pos-app.tsx 参照)。
// 認証なしは他の /api/pos-order/* と同じ理由。
export async function POST(_req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('id, status, table_code, receipt_token, subtotal, vat, service, coupon_discount, order_discount, total')
    .eq('id', id)
    .eq('store_id', storeId)
    .maybeSingle();
  if (orderError) return NextResponse.json({ error: orderError.message }, { status: 500 });
  if (!order) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  // begin-checkout (open) ・checkout-qr (awaiting_payment、ABA決済待ちで金額ロック済み) の
  // どちらからでも、お客様の「やっぱり紙で」で現金会計に切り替えられるようにする
  // (complete/route.ts は 'open' のみ許可。ここはそれより広い)。
  if (order.status !== 'open' && order.status !== 'awaiting_payment') {
    return NextResponse.json({ error: 'この注文は既に会計済み・取消済みです' }, { status: 409 });
  }

  const { data: items, error: itemsError } = await supabase
    .from('order_items')
    .select('line_total, kitchen_done_at')
    .eq('order_id', id);
  if (itemsError) return NextResponse.json({ error: itemsError.message }, { status: 500 });
  // 提供済みになっていないと会計できないようにする (complete/route.ts と同じガード)。
  const unservedCount = (items ?? []).filter((it) => !it.kitchen_done_at).length;
  if (unservedCount > 0) {
    return NextResponse.json(
      { error: `提供済みになっていない商品が ${unservedCount} 点あります。提供済みにしてから会計してください。` },
      { status: 409 },
    );
  }

  let subtotal = order.subtotal;
  let vat = order.vat;
  let service = order.service;
  let couponDiscount = order.coupon_discount;
  let orderDiscount = order.order_discount;
  let total = order.total;
  if (order.status === 'open') {
    // checkout-qr未実施 (金額未ロック) の場合は /api/receipt/[token] と同じ計算方法で
    // その場で算出する (2026-10-07 追加。割引はまだ選べない時点なので常に0)。
    const { data: storeRow } = await supabase.from('stores').select('settings').eq('id', storeId).maybeSingle();
    const itemsSubtotal = (items ?? []).reduce((s, it) => s + it.line_total, 0);
    const stored = (storeRow?.settings && typeof storeRow.settings === 'object' ? storeRow.settings : {}) as Record<
      string,
      unknown
    >;
    const vatRate = typeof stored.vatRate === 'number' ? stored.vatRate : DEFAULT_SETTINGS.vatRate;
    const vatInclusive = typeof stored.vatInclusive === 'boolean' ? stored.vatInclusive : DEFAULT_SETTINGS.vatInclusive;
    const serviceRate = typeof stored.serviceRate === 'number' ? stored.serviceRate : DEFAULT_SETTINGS.serviceRate;
    const liveVat = vatInclusive ? itemsSubtotal - itemsSubtotal / (1 + vatRate / 100) : itemsSubtotal * (vatRate / 100);
    const liveService = itemsSubtotal * (serviceRate / 100);
    const base = vatInclusive ? itemsSubtotal - liveVat : itemsSubtotal;
    subtotal = itemsSubtotal;
    vat = liveVat;
    service = liveService;
    couponDiscount = 0;
    orderDiscount = 0;
    total = Math.max(0, base + liveService + liveVat);
  }

  // 現金の決済方法名: 店舗設定の「現金扱い」の決済方法があればその表示名を使う。
  // 見つからなければ素直に '現金' (pos.payments.method は自由文字列のスナップショット)。
  const { data: cashMethod } = await supabase
    .from('payment_methods')
    .select('name')
    .eq('store_id', storeId)
    .eq('is_cash', true)
    .eq('enabled', true)
    .order('sort_order', { ascending: true })
    .limit(1)
    .maybeSingle();
  const cashMethodName = cashMethod?.name ?? '現金';

  const isNewToken = !order.receipt_token;
  const token = order.receipt_token ?? randomBytes(32).toString('base64url');
  const nowIso = new Date().toISOString();
  const updatePayload: Record<string, unknown> = {
    status: 'paid',
    subtotal,
    vat,
    service,
    coupon_discount: couponDiscount,
    order_discount: orderDiscount,
    total,
    paid_at: nowIso,
    receipt_token: token,
    print_requested_at: nowIso,
  };
  if (isNewToken) updatePayload.receipt_token_created_at = nowIso;
  const { error: updateError } = await supabase.from('orders').update(updatePayload).eq('id', id);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  const { error: paymentError } = await supabase.from('payments').insert({
    order_id: id,
    method: cashMethodName,
    amount: total,
    confirmed_at: nowIso,
  });
  if (paymentError) return NextResponse.json({ error: paymentError.message }, { status: 500 });

  return NextResponse.json({ ok: true, token });
}
