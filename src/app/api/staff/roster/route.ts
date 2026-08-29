import { NextResponse } from 'next/server';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';

// ログイン画面でスタッフが自分の名前を選ぶための一覧。
// 未ログインでも呼べるが、氏名と id だけを返し PIN やロールなどは一切含めない。
export async function GET() {
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data, error } = await supabase
    .from('staff')
    .select('id, display_name')
    .eq('store_id', storeId)
    .eq('active', true)
    .order('display_name');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ staff: data ?? [] });
}
