import { NextResponse } from 'next/server';
import { getStaffSessionFromCookies } from '@/lib/pos-auth';

// POS ネイティブ (PIN) セッションのログイン状態チェック。
// matsunoya-dine 連携 (dine_live) 側の /api/pos/session とは別物。
export async function GET() {
  const session = await getStaffSessionFromCookies();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return NextResponse.json({
    staff: {
      id: session.staffId,
      display_name: session.displayName,
      role: session.role,
      store_id: session.storeId,
    },
  });
}
