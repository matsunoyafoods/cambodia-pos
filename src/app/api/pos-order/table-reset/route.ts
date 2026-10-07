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
//
// 2026-10-07 追加: ここで void にした伝票も pos.order_void_log に記録するようにした。
// 正式な会計取消 (/api/orders/[id]/void) と違いここは完全に無記録で消えていたため、
// QR決済待ち中 (awaiting_payment) だった伝票がテーブルリセットで静かに消え、スタッフが
// 後から「売上が保存されていない」と気づくまで誰も気づけなかった事例が発生したため。
// テーブルリセットはレジ端末から直接・無認証で呼ばれスタッフ個人を特定できないので、
// voided_by は null、voided_by_name は操作元が分かる固定文言にする。

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
    .select(
      'id, table_code, status, subtotal, vat, service, coupon_discount, order_discount, total, guest_ethnicity, guest_kids_count',
    )
    .eq('store_id', storeId)
    .eq('table_code', tableCode)
    // 'awaiting_payment' (QR+ABA決済待ち。2026-10-06 追加) もリセット対象に含める。
    // 客がQR決済を開始せず/失敗して席を離れた卓を、スタッフがリセットできるようにするため。
    .in('status', ['open', 'awaiting_payment'])
    .maybeSingle();
  if (openOrderError) return NextResponse.json({ error: openOrderError.message }, { status: 500 });

  if (openOrder) {
    const { data: items, error: itemsError } = await supabase
      .from('order_items')
      .select('id, menu_name, qty, unit_price, selected_options, line_total')
      .eq('order_id', openOrder.id);
    if (itemsError) return NextResponse.json({ error: itemsError.message }, { status: 500 });

    const snapshot = {
      subtotal: Number(openOrder.subtotal),
      vat: Number(openOrder.vat),
      service: Number(openOrder.service),
      couponDiscount: Number(openOrder.coupon_discount),
      orderDiscount: Number(openOrder.order_discount),
      total: Number(openOrder.total),
      paidAt: null,
      guestEthnicity: openOrder.guest_ethnicity,
      guestKidsCount: openOrder.guest_kids_count,
      items: items ?? [],
      payments: [],
      statusBeforeReset: openOrder.status,
    };

    const { error: logError } = await supabase.from('order_void_log').insert({
      order_id: openOrder.id,
      store_id: storeId,
      table_code: openOrder.table_code,
      reason: 'テーブルリセットによる自動取消',
      snapshot,
      voided_by: null,
      voided_by_name: 'テーブルリセット(レジ操作)',
    });
    if (logError) return NextResponse.json({ error: logError.message }, { status: 500 });

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
