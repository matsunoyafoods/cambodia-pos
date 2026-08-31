import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';

// テーブルリセット: 間違えて選択・注文してしまった卓を、会計せずに「未使用」へ戻す
// (2026-08-31 追加。「間違えてテーブルを選択した場合に会計をしない限り赤いマークが
// 消えません。間違えて選択しても赤マークを消すことができるようにしてください」)。
//   - 開いている伝票 (pos.orders, status='open') があれば status='void' にする
//     (会計合算の合算元と同じ扱い。日報の集計からは自動的に除外される想定)。
//   - 滞在セッション (pos.table_sessions) を削除し、卓を「空席」に戻す
//     (テーブルの赤マークはセッションの有無だけで決まるため、これで消える)。
//   - 開いている伝票が既に無い場合もエラーにはせず、セッションだけ削除して成功扱いにする
//     (万一の状態不整合でも「とにかく赤マークを消す」操作として使えるようにするため)。
// 認証なしは他の /api/pos-order/* と同じ理由 (レジ端末からの直接呼び出し)。

const postSchema = z.object({
  tableCode: z.string().min(1),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = postSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }
  const { tableCode } = parsed.data;

  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data: openOrder, error: openOrderError } = await supabase
    .from('orders')
    .select('id')
    .eq('store_id', storeId)
    .eq('table_code', tableCode)
    .eq('status', 'open')
    .maybeSingle();
  if (openOrderError) return NextResponse.json({ error: openOrderError.message }, { status: 500 });

  if (openOrder) {
    const { error: voidError } = await supabase.from('orders').update({ status: 'void' }).eq('id', openOrder.id);
    if (voidError) return NextResponse.json({ error: voidError.message }, { status: 500 });
  }

  const { error: sessionError } = await supabase
    .from('table_sessions')
    .delete()
    .eq('store_id', storeId)
    .eq('table_code', tableCode);
  if (sessionError) return NextResponse.json({ error: sessionError.message }, { status: 500 });

  return NextResponse.json({ ok: true, hadOpenOrder: Boolean(openOrder) });
}
