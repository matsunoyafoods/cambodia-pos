import { NextResponse } from 'next/server';
import { orderStatusBlockedMessage } from '@/lib/pos-order-status-message';
import { randomBytes } from 'crypto';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/pos-order/orders/[id]/begin-checkout : レジ画面で「会計へ進む」を押した時点で
// お客様向けデジタルレシート (/receipt/{token}) 用のトークンを先行発行する (2026-10-07 追加。
// Tom「POSレジ本体で会計へ進むボタンを押すとハンディ側のテーブルの色が変わりテーブルを
// 押すとQRが表示できるようにしたい」への対応)。
//
// この時点では支払い方法もまだ選んでおらず、割引も確定していない。status は 'open' のまま
// 変更しない (checkout-screen 側の会計方法選択・割引入力を一切ブロックしない)。
// /api/receipt/[token] はこの状態 (status='open') の注文については、保存済みの
// subtotal/vat/service/total 列 (まだ未確定) ではなく、その場で order_items から計算した
// ライブの金額を返す (receipt/[token]/route.ts 参照)。
//
// 既に発行済みのトークンがあれば (再度「会計へ進む」を押した場合や、既にQR決済フロー等で
// 発行済みの場合) 同じトークンを返すだけで、新しいトークンへの差し替えは行わない —
// お客様が既に開いているQR/明細ページのURLを無効にしないため (checkout-qr/route.ts の
// 「何回でも開ける」対応と同じ考え方)。
// 認証なしは他の pos-order/* ルートと同じ理由 (dine連携ログインのCookieは別オリジンのため
// このサーバーから見えず、withPosStaff を使うとレジ画面自体が読めなくなってしまう)。
export async function POST(_req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
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

  if (order.receipt_token) {
    return NextResponse.json({ token: order.receipt_token });
  }
  if (order.status !== 'open') {
    return NextResponse.json({ error: orderStatusBlockedMessage(order.status) }, { status: 409 });
  }

  const token = randomBytes(32).toString('base64url');
  const { error: updateError } = await supabase
    .from('orders')
    .update({ receipt_token: token, receipt_token_created_at: new Date().toISOString() })
    .eq('id', id);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  return NextResponse.json({ token });
}
