import { NextResponse } from 'next/server';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';

// テーブルマップの「会計待ち」ステータス判定用 (2026-09-04 追加)。
// Tom「会計待ちが機能してないから、会計待ち押して席カード押したら会計待ちが分かるように
// して欲しい。今の場所だと分かりにくい」への対応。
//
// 元々は「今この端末で会計画面を開いている卓」だけを会計待ち扱いにしていたため、他の卓が
// 食べ終わって会計待ちになっていてもテーブルマップには一切反映されず、フィルターが実質
// 機能していなかった。ここでは「厨房送信済みの品目が1つ以上あり、かつその全てが提供完了
// (kitchen_done_at セット済み) になっている open 注文」を持つ卓を「会計待ち」として返す —
// つまり注文を出し終えて食事も配膳済み、あとは会計するだけの状態の卓。
// 認証なしは他の /api/pos-order/* と同じ理由 (dine連携ログインのCookieは別オリジンのため
// このサーバーから見えず、withPosStaff を使うとテーブルマップ自体が読めなくなる)。

export async function GET() {
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data: orders, error: ordersError } = await supabase
    .from('orders')
    .select('id, table_code')
    .eq('store_id', storeId)
    .eq('status', 'open');
  if (ordersError) return NextResponse.json({ error: ordersError.message }, { status: 500 });

  // デジタルレシートQRが表示できる卓一覧 (2026-10-07 追加。Tom「POSレジ本体で会計へ進む
  // ボタンを押すとハンディ側のテーブルの色が変わりテーブルを押すとQRが表示できるように
  // したい」への対応)。begin-checkout (会計へ進む) で先行発行したトークンも、
  // checkout-qr (ABA決済QR) で発行したトークンも、ここでは区別せず同じ仕組みで返す —
  // ハンディ側はこのトークンを使って /receipt/{token} のQRを描画するだけでよい。
  // status='paid'/'void' の卓は (会計完了・取消済みのため) 含めない。
  // 注意: open 注文が0件の時に早期 return する分岐 (下記) より前に必ず計算すること
  // (2026-10-07: 早期 return の後に置いていたため、未会計の注文が1件もない時間帯は
  // receiptTables が応答に含まれず、ハンディ側で TypeError が起きて画面全体が
  // 「メニュー・設定の取得に失敗しました」エラーになっていた)。
  const { data: receiptOrders, error: receiptError } = await supabase
    .from('orders')
    .select('table_code, receipt_token')
    .eq('store_id', storeId)
    .in('status', ['open', 'awaiting_payment'])
    .not('receipt_token', 'is', null);
  if (receiptError) return NextResponse.json({ error: receiptError.message }, { status: 500 });

  const receiptTables = (receiptOrders ?? []).map((o) => ({ code: o.table_code, token: o.receipt_token as string }));

  const orderIds = (orders ?? []).map((o) => o.id);
  if (orderIds.length === 0) {
    return NextResponse.json({ readyTableCodes: [], receiptTables });
  }

  const { data: items, error: itemsError } = await supabase
    .from('order_items')
    .select('order_id, kitchen_done_at')
    .in('order_id', orderIds)
    .not('sent_to_kitchen_at', 'is', null);
  if (itemsError) return NextResponse.json({ error: itemsError.message }, { status: 500 });

  const itemsByOrder = new Map<string, { done: number; total: number }>();
  for (const it of items ?? []) {
    const bucket = itemsByOrder.get(it.order_id) ?? { done: 0, total: 0 };
    bucket.total += 1;
    if (it.kitchen_done_at) bucket.done += 1;
    itemsByOrder.set(it.order_id, bucket);
  }

  const readyTableCodes = (orders ?? [])
    .filter((o) => {
      const bucket = itemsByOrder.get(o.id);
      return Boolean(bucket && bucket.total > 0 && bucket.done === bucket.total);
    })
    .map((o) => o.table_code);

  return NextResponse.json({ readyTableCodes, receiptTables });
}
