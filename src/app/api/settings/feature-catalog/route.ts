import { NextResponse } from 'next/server';
import { createPosAdminClient } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';
import { FEATURE_KEYS, type FeatureKey } from '@/lib/pos-types';

// 機能ごとの月額価格一覧 (全店舗共通、pos.feature_catalog)。設定画面「使用する機能」タブで
// 各機能の価格を表示するために使う (contract-management-addendum-2026-11 参照)。
// 価格そのものを編集するのは契約店舗管理画面 (cambodia-pos-admin、別アプリ) のみで、
// このエンドポイントは読み取り専用。閲覧は part_time 以上 (設定画面を開けるスタッフ全員)。

export type FeatureCatalogEntry = {
  featureKey: FeatureKey;
  monthlyPriceUsd: number;
};

export const GET = withPosStaff('part_time', async () => {
  const supabase = createPosAdminClient();

  const { data, error } = await supabase
    .from('feature_catalog')
    .select('feature_key, monthly_price_usd')
    .order('sort_order');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const byKey = new Map((data ?? []).map((row) => [row.feature_key, Number(row.monthly_price_usd)]));
  const entries: FeatureCatalogEntry[] = FEATURE_KEYS.map((key) => ({
    featureKey: key,
    monthlyPriceUsd: byKey.get(key) ?? 0,
  }));

  return NextResponse.json({ entries });
});
