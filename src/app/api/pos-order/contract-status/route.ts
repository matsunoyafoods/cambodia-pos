import { NextResponse } from 'next/server';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';

// レジ画面向け、契約・トライアル状況の公開読み取りエンドポイント (認証なし・理由は
// menu/route.ts と同じ)。店舗側の画面でトライアル残り日数バナーを出すために使う
// (contract-management-addendum-2026-11 参照)。store_id は常に POS_STORE_ID から解決する
// ため、他店舗の契約情報が見えることはない。

export async function GET() {
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data, error } = await supabase
    .from('stores')
    .select('contract_status, trial_ends_at')
    .eq('id', storeId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    contractStatus: data?.contract_status ?? 'trial',
    trialEndsAt: data?.trial_ends_at ?? null,
  });
}
