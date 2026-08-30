import { NextResponse } from 'next/server';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';

// レジ画面 (テーブルマップ) 向け、テーブルレイアウトの公開読み取りエンドポイント (認証なし)。
// 理由は同ディレクトリの mode/menu/settings と同じ: dine 連携ログインの Cookie は
// 別オリジンのためこのサーバーから見えず、withPosStaff を使うとレジ画面自体が
// 読めなくなってしまう。卓・柱・カウンターの名前・座標・サイズのみで機微情報は含まない。
export async function GET() {
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data, error } = await supabase
    .from('table_layouts')
    .select('id, table_code, kind, seats, x, y, width, height, sort_order')
    .eq('store_id', storeId)
    .order('sort_order')
    .order('table_code');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ items: data ?? [] });
}
