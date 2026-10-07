import { NextResponse } from 'next/server';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/pos-order/orders/[id]/mark-printed : レジ画面が紙レシート発行待ちの通知
// (print_requested_at) を見て実際に印刷命令を送った後、このフラグを下ろす
// (2026-10-07 追加。request-paper-receipt/route.ts 参照)。認証なしは他の /api/pos-order/* と同じ理由。
export async function POST(_req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { error } = await supabase
    .from('orders')
    .update({ print_requested_at: null })
    .eq('id', id)
    .eq('store_id', storeId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
