import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';

// ローカル印刷エージェント認証用トークンの発行・確認 (2026-08-31 プリンター実装で追加)。
// pos.stores.settings.printAgentToken (jsonb) に保存する (新規マイグレーション不要)。

type StoredSettings = { printAgentToken?: string };

export const GET = withPosStaff('manager', async () => {
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();
  const { data, error } = await supabase.from('stores').select('settings').eq('id', storeId).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const stored = (data?.settings && typeof data.settings === 'object' ? data.settings : {}) as StoredSettings;
  return NextResponse.json({ token: stored.printAgentToken ?? null });
});

// 再発行。既存トークンで動いているエージェントは古いトークンが使えなくなるので、
// 設定画面側で「再発行後はエージェント側の設定も更新してください」と案内する。
export const POST = withPosStaff('manager', async () => {
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data: existing, error: readError } = await supabase
    .from('stores')
    .select('settings')
    .eq('id', storeId)
    .maybeSingle();
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });

  const current = (existing?.settings && typeof existing.settings === 'object' ? existing.settings : {}) as Record<
    string,
    unknown
  >;
  const token = crypto.randomBytes(24).toString('hex');
  const merged = { ...current, printAgentToken: token };

  const { error } = await supabase
    .from('stores')
    .update({ settings: merged, updated_at: new Date().toISOString() })
    .eq('id', storeId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ token });
});
