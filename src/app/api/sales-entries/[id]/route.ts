import { NextResponse } from 'next/server';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';

type RouteContext = { params: Promise<{ id: string }> };

// 手入力売上の削除 (入力ミスの取り消し用)。manager 以上・sub_manager は締め出す。
export const DELETE = withPosStaff(
  'manager',
  async (_session, _req, ctx: RouteContext) => {
    const { id } = await ctx.params;
    const supabase = createPosAdminClient();
    const storeId = getPosStoreId();
    const { error } = await supabase.from('manual_daily_sales').delete().eq('id', id).eq('store_id', storeId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  },
  { deny: ['sub_manager'] },
);
