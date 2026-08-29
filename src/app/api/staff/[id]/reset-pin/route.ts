import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff, hashPin } from '@/lib/pos-auth';

const bodySchema = z.object({
  pin: z.string().regex(/^\d{4,8}$/, 'PIN は4〜8桁の数字で入力してください'),
});

type RouteContext = { params: Promise<{ id: string }> };

// PIN リセット。manager 以上のみ。
export const POST = withPosStaff('manager', async (_session, req, ctx: RouteContext) => {
  const { id } = await ctx.params;
  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const storeId = getPosStoreId();
  const supabase = createPosAdminClient();
  const pinHash = await hashPin(parsed.data.pin);

  const { data, error } = await supabase
    .from('staff')
    .update({ pin_hash: pinHash, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('store_id', storeId)
    .select('id, display_name, role, active')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return NextResponse.json({ staff: data });
});
