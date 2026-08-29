import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { verifyPin, issueStaffSessionToken, setStaffSessionCookie, type PosStaffRole } from '@/lib/pos-auth';

const bodySchema = z.object({
  staffId: z.string().uuid(),
  pin: z.string().min(4).max(8),
});

export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  const { staffId, pin } = parsed.data;
  const storeId = getPosStoreId();
  const supabase = createPosAdminClient();

  const { data: staff, error } = await supabase
    .from('staff')
    .select('id, store_id, display_name, role, pin_hash, active')
    .eq('id', staffId)
    .eq('store_id', storeId)
    .maybeSingle();

  // 存在しない/非アクティブ/PIN不一致のいずれも同じ 401 (アカウント有無を漏らさない)
  if (error || !staff || !staff.active) {
    return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
  }

  const ok = await verifyPin(pin, staff.pin_hash);
  if (!ok) {
    return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
  }

  const token = await issueStaffSessionToken({
    staffId: staff.id,
    storeId: staff.store_id,
    displayName: staff.display_name,
    role: staff.role as PosStaffRole,
  });
  await setStaffSessionCookie(token);

  return NextResponse.json({
    staff: { id: staff.id, display_name: staff.display_name, role: staff.role, store_id: staff.store_id },
  });
}
