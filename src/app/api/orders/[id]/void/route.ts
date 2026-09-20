import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';

type RouteContext = { params: Promise<{ id: string }> };

// 会計取消 (2026-09-20 追加)。manager以上限定 (deny sub_manager。売上に関わる操作のため
// sales-report/register-closings 等と同じ権限線引き)。会計を間違えて完了してしまった注文を
// 取消し (status='paid' → 'void')、売上集計から除外する。取消前の内容は pos.order_void_log に
// snapshot として保存し、誰が・いつ・なぜ取消したかを残す (Tom「履歴を編集した場合履歴が
// 残るようにしてください」への対応)。取消後の再会計は、同じ卓で通常の「テーブルを開く」
// フローから新しい注文を作ってやり直す運用とする (詳細は migration のコメント参照)。
const postSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export const POST = withPosStaff(
  'manager',
  async (session, req, ctx: RouteContext) => {
    const { id } = await ctx.params;
    const json = await req.json().catch(() => ({}));
    const parsed = postSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
    }

    const supabase = createPosAdminClient();
    const storeId = getPosStoreId();

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select(
        'id, table_code, status, subtotal, vat, service, coupon_discount, order_discount, total, paid_at, guest_ethnicity, guest_kids_count',
      )
      .eq('id', id)
      .eq('store_id', storeId)
      .maybeSingle();
    if (orderError) return NextResponse.json({ error: orderError.message }, { status: 500 });
    if (!order) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    if (order.status !== 'paid') {
      return NextResponse.json({ error: 'この注文は会計済みではないため取消できません (既に取消済み、または未会計です)' }, { status: 409 });
    }

    const { data: items, error: itemsError } = await supabase
      .from('order_items')
      .select('id, menu_name, qty, unit_price, selected_options, line_total')
      .eq('order_id', id);
    if (itemsError) return NextResponse.json({ error: itemsError.message }, { status: 500 });

    const { data: payments, error: paymentsError } = await supabase
      .from('payments')
      .select('id, method, amount, cash_received_usd, cash_received_khr, change_usd, change_khr, confirmed_at')
      .eq('order_id', id);
    if (paymentsError) return NextResponse.json({ error: paymentsError.message }, { status: 500 });

    const snapshot = {
      subtotal: Number(order.subtotal),
      vat: Number(order.vat),
      service: Number(order.service),
      couponDiscount: Number(order.coupon_discount),
      orderDiscount: Number(order.order_discount),
      total: Number(order.total),
      paidAt: order.paid_at,
      guestEthnicity: order.guest_ethnicity,
      guestKidsCount: order.guest_kids_count,
      items: items ?? [],
      payments: payments ?? [],
    };

    const { error: logError } = await supabase.from('order_void_log').insert({
      order_id: id,
      store_id: storeId,
      table_code: order.table_code,
      reason: parsed.data.reason || null,
      snapshot,
      voided_by: session.staffId,
      voided_by_name: session.displayName,
    });
    if (logError) return NextResponse.json({ error: logError.message }, { status: 500 });

    const { error: updateError } = await supabase.from('orders').update({ status: 'void' }).eq('id', id);
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  },
  { deny: ['sub_manager'] },
);
