import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';

// 席移動: 開いている伝票(pos.orders)とその滞在セッション(pos.table_sessions)を、
// 別のテーブルへまるごと移す (2026-08-31 追加。「テーブルの席移動になった時用の機能」)。
// 滞在・飲み放題タイマーの起点は変えない (物理的に席を移っただけなので、来店してからの
// 経過時間はそのまま引き継ぐ)。認証なしは他の /api/pos-order/* と同じ理由。

const postSchema = z.object({
  fromTableCode: z.string().min(1),
  toTableCode: z.string().min(1),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = postSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }
  const { fromTableCode, toTableCode } = parsed.data;
  if (fromTableCode === toTableCode) {
    return NextResponse.json({ error: '同じテーブルは選べません' }, { status: 400 });
  }

  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data: fromOrder, error: fromOrderError } = await supabase
    .from('orders')
    .select('id')
    .eq('store_id', storeId)
    .eq('table_code', fromTableCode)
    .eq('status', 'open')
    .maybeSingle();
  if (fromOrderError) return NextResponse.json({ error: fromOrderError.message }, { status: 500 });
  if (!fromOrder) return NextResponse.json({ error: '移動元のテーブルに開いている伝票がありません' }, { status: 400 });

  const { data: toOrder, error: toOrderError } = await supabase
    .from('orders')
    .select('id')
    .eq('store_id', storeId)
    .eq('table_code', toTableCode)
    .eq('status', 'open')
    .maybeSingle();
  if (toOrderError) return NextResponse.json({ error: toOrderError.message }, { status: 500 });
  if (toOrder) return NextResponse.json({ error: '移動先のテーブルは既に使用中です' }, { status: 400 });

  const { error: updateOrderError } = await supabase.from('orders').update({ table_code: toTableCode }).eq('id', fromOrder.id);
  if (updateOrderError) return NextResponse.json({ error: updateOrderError.message }, { status: 500 });

  // 移動先に (通常は無いはずだが、念のため) 古いセッションが残っていたら消してから移す。
  await supabase.from('table_sessions').delete().eq('store_id', storeId).eq('table_code', toTableCode);
  const { error: sessionError } = await supabase
    .from('table_sessions')
    .update({ table_code: toTableCode, updated_at: new Date().toISOString() })
    .eq('store_id', storeId)
    .eq('table_code', fromTableCode);
  if (sessionError) return NextResponse.json({ error: sessionError.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
