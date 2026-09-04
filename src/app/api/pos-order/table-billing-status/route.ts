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

  const orderIds = (orders ?? []).map((o) => o.id);
  if (orderIds.length === 0) {
    return NextResponse.json({ readyTableCodes: [] });
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

  return NextResponse.json({ readyTableCodes });
}
