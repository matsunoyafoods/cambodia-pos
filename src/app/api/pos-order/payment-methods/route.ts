import { NextResponse } from 'next/server';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import type { PaymentMethodConfig } from '@/lib/pos-types';

// レジ画面 (会計画面) 向け、有効な決済方法一覧の公開読み取りエンドポイント
// (認証なし・理由は menu/route.ts 等の他の /api/pos-order/* と同じ)。
// 無効化された決済方法はここには含めない (管理用の一覧は /api/settings/payment-methods)。

export async function GET() {
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();
  const { data, error } = await supabase
    .from('payment_methods')
    .select('id, name, is_cash, enabled, sort_order')
    .eq('store_id', storeId)
    .eq('enabled', true)
    .order('sort_order', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const paymentMethods: PaymentMethodConfig[] = (data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    isCash: p.is_cash,
    enabled: p.enabled,
    sortOrder: p.sort_order,
  }));
  return NextResponse.json({ paymentMethods });
}
