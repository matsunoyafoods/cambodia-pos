import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';

// キッチンモニターの「調理完了」/「元に戻す」操作 (2026-09-03 追加。詳細は
// ../route.ts のコメント参照)。認証なしは同様の理由 (dine連携ログインでも使えるように)。
//
// テナント分離の補強 (§0.1fのtimecardsと同じ考え方): order_items 自体には store_id が無い
// (order_id 経由でしか店舗に紐づかない) ため、対象品目が自店舗の open 注文のものであることを
// 確認してから更新する。将来 D-簡易で複数店舗が同一Supabaseプロジェクトを共有するようになった
// 際に、UUIDを知っていれば他店舗の品目を操作できてしまう抜け穴を未然に防ぐため。
//
// 2026-09-05 追加: 数量が2以上の品目を1個ずつ完了できるようにする (Tomからの要望
// 「Chicken Broccoli × 3 の3個のところを1個づつでも完了できて数量が減っていくように
// したい」)。既存の { done: boolean } (レジ画面の提供完了トグルが使う、全数を一括で
// 完了/未完了にする方式) はそのまま残しつつ、新しく { action: 'completeOne' } を追加した。
// これは kitchen_done_qty (完了済み数量) を1個だけ進め、qty に達したら kitchen_done_at を
// セットして「その品目は全数完了」の状態にする。
const patchSchema = z.union([
  z.object({ done: z.boolean(), staffName: z.string().max(60).optional() }),
  z.object({ action: z.literal('completeOne'), staffName: z.string().max(60).optional() }),
]);

const itemSelect = 'id, order_id, menu_name, qty, selected_options, sent_to_kitchen_at, kitchen_done_at, kitchen_done_by_name, kitchen_done_qty';

export async function PATCH(req: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  const json = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data: item, error: itemError } = await supabase
    .from('order_items')
    .select('id, order_id, qty, kitchen_done_qty')
    .eq('id', itemId)
    .maybeSingle();
  if (itemError) return NextResponse.json({ error: itemError.message }, { status: 500 });
  if (!item) return NextResponse.json({ error: '品目が見つかりません' }, { status: 404 });

  const { data: order, error: orderError } = await supabase.from('orders').select('id').eq('id', item.order_id).eq('store_id', storeId).maybeSingle();
  if (orderError) return NextResponse.json({ error: orderError.message }, { status: 500 });
  if (!order) return NextResponse.json({ error: '品目が見つかりません' }, { status: 404 });

  let update: { kitchen_done_at: string | null; kitchen_done_by_name: string | null; kitchen_done_qty: number };

  if ('done' in parsed.data) {
    const { done, staffName } = parsed.data;
    update = {
      kitchen_done_at: done ? new Date().toISOString() : null,
      kitchen_done_by_name: done ? (staffName ?? null) : null,
      kitchen_done_qty: done ? item.qty : 0,
    };
  } else {
    const { staffName } = parsed.data;
    const nextQty = Math.min(item.qty, (item.kitchen_done_qty ?? 0) + 1);
    const nowDone = nextQty >= item.qty;
    update = {
      kitchen_done_qty: nextQty,
      kitchen_done_at: nowDone ? new Date().toISOString() : null,
      kitchen_done_by_name: nowDone ? (staffName ?? null) : null,
    };
  }

  const { data, error } = await supabase.from('order_items').update(update).eq('id', itemId).select(itemSelect).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ item: data });
}
