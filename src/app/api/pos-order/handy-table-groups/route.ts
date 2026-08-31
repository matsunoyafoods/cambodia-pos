import { NextResponse } from 'next/server';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import type { HandyTableGroup } from '@/lib/pos-types';

// ハンディ注文画面 (認証はPOS PINログインだが、/api/pos-order/* は他ルートと同じ理由で
// withPosStaff を使わない公開API) 向け、卓グループ設定の読み取り専用エンドポイント
// (2026-08-31 追加)。設定自体の変更は /api/settings/handy-table-groups (owner/manager限定) で行う。

type StoredSettings = { handyTableGroups?: HandyTableGroup[] };

export async function GET() {
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();
  const { data, error } = await supabase.from('stores').select('settings').eq('id', storeId).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const stored = (data?.settings && typeof data.settings === 'object' ? data.settings : {}) as StoredSettings;
  return NextResponse.json({ groups: stored.handyTableGroups ?? [] });
}
