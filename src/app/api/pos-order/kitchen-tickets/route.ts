import { NextResponse } from 'next/server';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';

// キッチンモニター機能 (2026-09-03 追加)。Tomからの要望「キッチンはハンディーのように
// キッチンモニターに設定すればキッチンモニターとして使えるようになれば簡単」に対応。紙の
// 厨房伝票 (プリンター) の代わりに、確定・厨房送信された注文品目をタブレット画面へ一覧表示し、
// 「調理完了」をタップすると消える (kitchen_done_at を記録する) だけのシンプルな仕組み。
// 既存の厨房プリンター機能とは独立しており、プリンターを併用している店舗にも影響しない
// (pos.order_items.sent_to_kitchen_at は今まで通り注文確定時にセットされる)。
// 認証なしは他の /api/pos-order/* と同じ理由 (dine連携ログインのCookieは別オリジンのため
// このサーバーから見えず、withPosStaff を使うとキッチンモニター画面自体が読めなくなる)。

const orderItemSelect = 'id, order_id, menu_name, qty, selected_options, sent_to_kitchen_at, kitchen_done_at, kitchen_done_by_name';

// GET /api/pos-order/kitchen-tickets : 未対応 (厨房送信済み・調理未完了) の品目一覧と、
// 直近10分以内に完了した品目一覧 (誤操作時の「元に戻す」用) を返す。
export async function GET() {
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data: orders, error: ordersError } = await supabase.from('orders').select('id, table_code').eq('store_id', storeId).eq('status', 'open');
  if (ordersError) return NextResponse.json({ error: ordersError.message }, { status: 500 });

  const orderIds = (orders ?? []).map((o) => o.id);
  if (orderIds.length === 0) {
    return NextResponse.json({ pending: [], recentlyDone: [] });
  }
  const tableCodeByOrderId = new Map((orders ?? []).map((o) => [o.id, o.table_code]));

  const { data: items, error: itemsError } = await supabase
    .from('order_items')
    .select(orderItemSelect)
    .in('order_id', orderIds)
    .not('sent_to_kitchen_at', 'is', null)
    .order('sent_to_kitchen_at', { ascending: true });
  if (itemsError) return NextResponse.json({ error: itemsError.message }, { status: 500 });

  const withTable = (items ?? []).map((it) => ({ ...it, table_code: tableCodeByOrderId.get(it.order_id) ?? null }));
  const pending = withTable.filter((it) => !it.kitchen_done_at);

  const recentThreshold = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const recentlyDone = withTable
    .filter((it) => it.kitchen_done_at && it.kitchen_done_at >= recentThreshold)
    .sort((a, b) => (a.kitchen_done_at! < b.kitchen_done_at! ? 1 : -1))
    .slice(0, 20);

  return NextResponse.json({ pending, recentlyDone });
}
