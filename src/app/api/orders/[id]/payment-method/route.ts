import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';

type RouteContext = { params: Promise<{ id: string }> };

// 決済方法の遡及修正 (2026-10-17 追加)。Tom「すべてキャッシュになっています。これを
// 遡ってスタッフが支払い方法を編集できますか？」への対応。原因は「紙レシートでもらう」が
// 選択中の決済方法を無視して常に現金記録していた設計バグ (pos-app.tsx 側で別途修正済み)。
// 既に確定済みの会計の決済方法を、店舗設定の決済方法一覧にある名前へ修正できるようにする。
// manager以上限定 (deny sub_manager。売上・お金に関わる操作のため他の同種ルートと同じ
// 権限線引き)。分割払い (支払いラインが複数) は「どの行を直すか」が曖昧になるため、
// このエンドポイントではサポートしない (支払いラインが1本の会計のみ修正可)。
const patchSchema = z.object({
  method: z.string().trim().min(1).max(60),
});

export const PATCH = withPosStaff(
  'manager',
  async (session, req, ctx: RouteContext) => {
    const { id } = await ctx.params;
    const json = await req.json().catch(() => null);
    const parsed = patchSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
    }

    const supabase = createPosAdminClient();
    const storeId = getPosStoreId();

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, status')
      .eq('id', id)
      .eq('store_id', storeId)
      .maybeSingle();
    if (orderError) return NextResponse.json({ error: orderError.message }, { status: 500 });
    if (!order) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    if (order.status !== 'paid') {
      return NextResponse.json({ error: '会計済みの注文のみ決済方法を修正できます' }, { status: 409 });
    }

    const { data: payments, error: paymentsError } = await supabase
      .from('payments')
      .select('id, method')
      .eq('order_id', id);
    if (paymentsError) return NextResponse.json({ error: paymentsError.message }, { status: 500 });
    if (!payments || payments.length === 0) {
      return NextResponse.json({ error: 'この注文には支払い記録がありません' }, { status: 409 });
    }
    if (payments.length > 1) {
      return NextResponse.json(
        { error: '分割払い (支払いラインが複数) の会計は、この画面では決済方法を修正できません' },
        { status: 409 },
      );
    }

    const payment = payments[0];
    const newMethod = parsed.data.method;
    if (payment.method === newMethod) {
      return NextResponse.json({ ok: true, method: newMethod });
    }

    const { error: updateError } = await supabase.from('payments').update({ method: newMethod }).eq('id', payment.id);
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

    const { error: logError } = await supabase.from('payment_method_edit_log').insert({
      store_id: storeId,
      order_id: id,
      payment_id: payment.id,
      old_method: payment.method,
      new_method: newMethod,
      edited_by: session.staffId,
      edited_by_name: session.displayName,
    });
    if (logError) {
      // 監査ログの失敗で修正自体は失わせない (修正は既に反映済み)。Vercelのランタイムログに残る。
      console.error('payment_method_edit_log insert failed', logError);
    }

    return NextResponse.json({ ok: true, method: newMethod });
  },
  { deny: ['sub_manager'] },
);
