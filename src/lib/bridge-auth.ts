import { NextResponse } from 'next/server';

// matsunoya-dine の Telegram Bot からPOSレジへ直接書き込むための認証 (2026-09-29 追加)。
// POSスタッフのブラウザセッション (pos_staff_session cookie、pos-auth.ts) は使えない
// (Botサーバー同士のやり取りのため、ブラウザのcookieを持たない) ので、共有シークレットを
// ヘッダーで渡すだけの単純な方式にした。対象は /api/bridge/* のみで、書き込める内容も
// 「経費のOCR下書きの作成・確認・却下」に限定されている (expense_ocr_drafts / expenses への
// 限定的な書き込みのみ、他のテーブルには触れない設計)。
//
// 環境変数 TELEGRAM_BRIDGE_SECRET は cambodia-pos・matsunoya-dine 両方の Vercel プロジェクトに
// 同じ値を設定しておく必要がある。
export function checkBridgeSecret(req: Request): NextResponse | null {
  const expected = process.env.TELEGRAM_BRIDGE_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'bridge_not_configured' }, { status: 503 });
  }
  const received = req.headers.get('x-bridge-secret');
  if (!received || received !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}
