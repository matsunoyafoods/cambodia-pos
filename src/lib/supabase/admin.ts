import { createClient } from '@supabase/supabase-js';

// POS ネイティブテーブル (pos.stores / pos.staff / pos.menu_* / pos.integrations) は
// RLS を有効化した上で anon/authenticated 向けの許可ポリシーを一切作っていない
// (multi-tenant-productization-spec.md §3.4)。アクセスは必ずこの service_role
// クライアント経由、かつ Route Handler 側で store_id・role を検証してから行う。
export function createPosAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: 'pos' },
  });
}

// Phase B 時点では 1 デプロイ = 1 店舗 (pos.stores の1行) という前提で、
// どの店舗かを環境変数で固定する。複数テナントを1デプロイで捌くマルチテナント
// ルーティングは Phase D (オンボーディングUI) で設計する
// (multi-tenant-productization-spec.md §5)。
export function getPosStoreId(): string {
  const storeId = process.env.POS_STORE_ID;
  if (!storeId) {
    throw new Error('Missing POS_STORE_ID (このデプロイがどの pos.stores 行を使うか未設定です)');
  }
  return storeId;
}
