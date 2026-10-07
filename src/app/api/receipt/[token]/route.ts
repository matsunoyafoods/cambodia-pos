import { NextResponse } from 'next/server';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';

// GET /api/receipt/[token] : お客様向け明細・レシートの公開 (認証なし) 読み取り専用
// エンドポイント (2026-10-06 追加。QR+ABA決済フロー フェーズ1)。
//
// 注文IDではなく checkout-qr/route.ts が発行した推測困難なトークンで検索するため、
// 他のお客様の注文IDを推測・列挙して覗くことはできない。書き込みは一切行わない — この
// ルートが返す金額はブラウザ側から変更できる経路を持たない (表示専用)。
type RouteContext = { params: Promise<{ token: string }> };

const orderSelect =
  'id, status, subtotal, vat, service, coupon_discount, order_discount, total, created_at, paid_at';
const itemSelect = 'menu_name, qty, unit_price, line_total';

export async function GET(_req: Request, ctx: RouteContext) {
  const { token } = await ctx.params;
  // トークンは32バイトのbase64url (約43文字)。極端に短い値は明らかに不正なので
  // DBに問い合わせる前に弾く。
  if (!token || token.length < 16) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select(orderSelect)
    .eq('store_id', storeId)
    .eq('receipt_token', token)
    .maybeSingle();
  if (orderError) return NextResponse.json({ error: orderError.message }, { status: 500 });
  if (!order) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const { data: items, error: itemsError } = await supabase
    .from('order_items')
    .select(itemSelect)
    .eq('order_id', order.id)
    .order('sent_to_kitchen_at');
  if (itemsError) return NextResponse.json({ error: itemsError.message }, { status: 500 });

  // 支払い方法 (PAID後の表示用。'ABA PayWay' 等。フェーズ1では存在しないことが多い)。
  const { data: payments } = await supabase
    .from('payments')
    .select('method')
    .eq('order_id', order.id)
    .order('confirmed_at', { ascending: false })
    .limit(1);

  const { data: storeRow } = await supabase.from('stores').select('name').eq('id', storeId).maybeSingle();

  return NextResponse.json({
    order: {
      status: order.status,
      subtotal: order.subtotal,
      vat: order.vat,
      service: order.service,
      couponDiscount: order.coupon_discount,
      orderDiscount: order.order_discount,
      total: order.total,
      createdAt: order.created_at,
      paidAt: order.paid_at,
    },
    items: (items ?? []).map((it) => ({
      name: it.menu_name,
      qty: it.qty,
      unitPrice: it.unit_price,
      lineTotal: it.line_total,
    })),
    paymentMethod: payments?.[0]?.method ?? null,
    storeName: storeRow?.name ?? '',
    // 店頭のABA静的KHQR決済QRの生データ (2026-10-07 追加。PayWayのマーチャント登録 (会社登録)
    // が済むまでの暫定対応。既存の店頭QRスタンドと全く同じ中身を複製しているだけで、金額は
    // 埋め込まれていない — お客様がABAアプリでスキャンし、画面のTOTALを見ながら金額を手入力
    // して支払う。未設定の店舗では null (フロント側でQR表示自体を出さない)。
    abaStaticKhqr: process.env.ABA_STATIC_KHQR_PAYLOAD ?? null,
  });
}
