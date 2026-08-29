import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff, hashPin } from '@/lib/pos-auth';

// スタッフ一覧 (role/active も含む、フル情報)。manager 以上のみ。
export const GET = withPosStaff('manager', async () => {
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data, error } = await supabase
    .from('staff')
    .select('id, display_name, role, active, created_at')
    .eq('store_id', storeId)
    .order('created_at');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ staff: data ?? [] });
});

const createSchema = z.object({
  displayName: z.string().trim().min(1).max(50),
  role: z.enum(['owner', 'manager', 'staff']),
  pin: z.string().regex(/^\d{4,8}$/, 'PIN は4〜8桁の数字で入力してください'),
});

// 新規スタッフ登録。manager 以上のみ。
export const POST = withPosStaff('manager', async (_session, req) => {
  const json = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }
  const { displayName, role, pin } = parsed.data;
  const storeId = getPosStoreId();
  const supabase = createPosAdminClient();
  const pinHash = await hashPin(pin);

  const { data, error } = await supabase
    .from('staff')
    .insert({ store_id: storeId, display_name: displayName, role, pin_hash: pinHash })
    .select('id, display_name, role, active, created_at')
    .single();

  if (error) {
    // unique (store_id, display_name) 制約違反
    const status = error.code === '23505' ? 409 : 500;
    const message = status === 409 ? '同じ名前のスタッフが既に登録されています' : error.message;
    return NextResponse.json({ error: message }, { status });
  }
  return NextResponse.json({ staff: data }, { status: 201 });
});
