import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/pos-order/orders/[id]/checkout-qr : QR+ABA決済フローの会計確定 (2026-10-06 追加。
// Tom「会計確定→QRを見せる→お客様のスマホでABA決済→自動でPAID」フェーズ1)。
//
// 既存の /complete (現金・カード・店舗設定の決済方法) とは別の並行ルート。この時点では
// 実際の支払いはまだ完了していない。ここでやるのは金額の確定 (ロック) と、お客様向け
// 明細ページ (/receipt/{token}) を指す推測困難なトークンの発行だけ。/complete と異なり
// payments は一切受け取らない・書き込まない。
//
// pos.payments への記録・status='paid' への変更は、PayWayからの決済成功をサーバー側で
// 確認できた時点 (Phase 3で実装予定。Webhook + Check Transaction API での照合) で初めて
// 行う。ブラウザの画面遷移やこのAPI自体の呼び出しを根拠にPAID化しない
// (Tom「ブラウザが支払い成功画面に戻ったことだけを根拠にPAIDにしないでください」への対応)。
//
// 認証なしは他の pos-order/* ルートと同じ理由 (dine連携ログインのCookieは別オリジンのため
// このサーバーから見えず、withPosStaff を使うとレジ画面自体が読めなくなってしまう)。
const postSchema = z.object({
  subtotal: z.number().min(0),
  vat: z.number().min(0),
  service: z.number().min(0),
  couponDiscount: z.number().min(0).default(0),
  orderDiscount: z.number().min(0).default(0),
  total: z.number().min(0),
});

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
    .select('id, status, receipt_token')
    .eq('id', id)
    .eq('store_id', storeId)
    .maybeSingle();
  if (orderError) return NextResponse.json({ error: orderError.message }, { status: 500 });
  if (!order) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // 既にこの注文でQR決済を開始済み (status='awaiting_payment') なら、金額の再ロックは
  // せずに同じトークンをそのまま返す。スタッフがQRモーダルを閉じてしまった後、もう一度
  // 「デジタルレシートを表示」を押しても毎回エラーにならず、何度でも開き直せるようにする
  // (Tom「何回でも開けるようにしてください」への対応、2026-10-07)。この状態では
  // items 側のガードにより商品も編集できないので、金額が変わる心配はない。
  if (order.status === 'awaiting_payment' && order.receipt_token) {
    return NextResponse.json({ token: order.receipt_token });
  }

  if (order.status !== 'open') {
    return NextResponse.json({ error: 'この注文は既に会計済み・取消済み・QR決済待ちです' }, { status: 409 });
  }

  // 提供済みになっていないと会計できないようにする (/complete と同じガード。
  // フロント側のdisabledだけで完結させない方針)。
  const { data: unservedItems, error: unservedError } = await supabase
    .from('order_items')
    .select('id')
    .eq('order_id', id)
    .is('kitchen_done_at', null);
  if (unservedError) return NextResponse.json({ error: unservedError.message }, { status: 500 });
  if ((unservedItems ?? []).length > 0) {
    return NextResponse.json(
      { error: `提供済みになっていない商品が ${unservedItems!.length} 点あります。提供済みにしてから会計してください。` },
      { status: 409 },
    );
  }

  // 推測困難なトークン (32バイト = 256bitのランダム値)。注文IDとは無関係なので、
  // トークンから他の注文を推測・列挙することはできない。すでに begin-checkout
  // (「会計へ進む」時点) でトークン発行済みなら、新しいトークンへの差し替えは行わず
  // 同じトークンを使い続ける (お客様が既に開いているQR/明細ページのURLを壊さないため)。
  const isNewToken = !order.receipt_token;
  const token = order.receipt_token ?? randomBytes(32).toString('base64url');
  const nowIso = new Date().toISOString();

  const updatePayload: Record<string, unknown> = {
    status: 'awaiting_payment',
    subtotal: d.subtotal,
    vat: d.vat,
    service: d.service,
    coupon_discount: d.couponDiscount,
    order_discount: d.orderDiscount,
    total: d.total,
    receipt_token: token,
  };
  if (isNewToken) updatePayload.receipt_token_created_at = nowIso;

  const { error: updateError } = await supabase
    .from('orders')
    .update(updatePayload)
    .eq('id', id);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  return NextResponse.json({ token });
}
