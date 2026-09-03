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

const patchSchema = z.object({
  done: z.boolean(),
  staffName: z.string().max(60).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  const json = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }
  const { done, staffName } = parsed.data;

  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data: item, error: itemError } = await supabase.from('order_items').select('id, order_id').eq('id', itemId).maybeSingle();
  if (itemError) return NextResponse.json({ error: itemError.message }, { status: 500 });
  if (!item) return NextResponse.json({ error: '品目が見つかりません' }, { status: 404 });

  const { data: order, error: orderError } = await supabase.from('orders').select('id').eq('id', item.order_id).eq('store_id', storeId).maybeSingle();
  if (orderError) return NextResponse.json({ error: orderError.message }, { status: 500 });
  if (!order) return NextResponse.json({ error: '品目が見つかりません' }, { status: 404 });

  const { data, error } = await supabase
    .from('order_items')
    .update({
      kitchen_done_at: done ? new Date().toISOString() : null,
      kitchen_done_by_name: done ? (staffName ?? null) : null,
    })
    .eq('id', itemId)
    .select('id, order_id, menu_name, qty, selected_options, sent_to_kitchen_at, kitchen_done_at, kitchen_done_by_name')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ item: data });
}
