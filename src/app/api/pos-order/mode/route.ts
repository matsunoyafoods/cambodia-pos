import { NextResponse } from 'next/server';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';

// レジ画面 (pos-app.tsx) がメニュー・設定をどこから読むかの判定用。
// 認証なし公開エンドポイント: dine 連携ログイン (Telegram bot-login) の Cookie は
// matsunoya-dine 側ドメインのものでこのサーバーからは見えない (別オリジン) ため、
// レジ画面の初期データ取得は withPosStaff を使えない。
// このデプロイの POS_STORE_ID 1店舗分の「どちらのメニューソースを使うか」という
// 非機微情報のみを返す (multi-tenant-productization-spec.md Phase C 設計方針)。
export async function GET() {
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data, error } = await supabase
    .from('integrations')
    .select('menu_source')
    .eq('store_id', storeId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  // 行が無い = 未移行の既存店舗 = これまで通り matsunoya-dine 連携動作を維持。
  const menuSource = data?.menu_source === 'pos_native' ? 'pos_native' : 'dine_live';
  return NextResponse.json({ menuSource });
}
