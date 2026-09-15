import { NextResponse } from 'next/server';
import { getStaffSessionFromCookies, issueStaffSessionToken, setStaffSessionCookie } from '@/lib/pos-auth';

// POS ネイティブ (PIN) セッションのログイン状態チェック。
// matsunoya-dine 連携 (dine_live) 側の /api/pos/session とは別物。
//
// スライディング延長 (2026-09-15 追加): 以前はセッションCookieの有効期限が
// ログイン時刻から固定12時間で、営業中にタブを開けっぱなしにしていると
// 気づかないうちに切れてしまい、pos_native → dine連携 (別セッションが残っていた場合)へ
// 無言でフォールバックしてしまっていた (Tom「左上の売上表示が消えてる」)。
// レジ画面 (staff-gate.tsx) がこのエンドポイントを定期的に呼び直す前提で、
// チェックが通るたびにCookieを新しい有効期限で発行し直し、実際に使われている
// 限りセッションが切れないようにする。
export async function GET() {
  const session = await getStaffSessionFromCookies();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const freshToken = await issueStaffSessionToken(session);
  await setStaffSessionCookie(freshToken);
  return NextResponse.json({
    staff: {
      id: session.staffId,
      display_name: session.displayName,
      role: session.role,
      store_id: session.storeId,
    },
  });
}
