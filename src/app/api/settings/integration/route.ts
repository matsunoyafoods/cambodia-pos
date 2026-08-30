import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';

// Phase C: matsunoya-dine 連携 ON/OFF の切り替え (pos.integrations.menu_source)。
// multi-tenant-productization-spec.md Phase C:
// 「松之屋フーズの pos.integrations を『連携ON』で作成し、現状の挙動を維持したまま移行」
//
// 行が無い店舗は常に 'dine_live' 扱いとする (＝ Tom に seed SQL を実行してもらわなくても、
// 現状の matsunoya-dine 連携動作がそのまま維持される)。
// dine_synced (差分同期モード) は将来拡張用に DB の check 制約には残すが、
// このAPI/画面ではまだ選択肢として出さない (未実装のため)。

export type IntegrationMode = 'pos_native' | 'dine_live';

// 参照。owner のみ (連携先の切り替えは店舗運用そのものに影響するため)。
export const GET = withPosStaff('owner', async () => {
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
  const menuSource: IntegrationMode = data?.menu_source === 'pos_native' ? 'pos_native' : 'dine_live';
  return NextResponse.json({ menuSource });
});

const patchSchema = z.object({
  menuSource: z.enum(['pos_native', 'dine_live']),
});

// 切り替え。owner のみ。
export const PATCH = withPosStaff('owner', async (_session, req) => {
  const json = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }

  const storeId = getPosStoreId();
  const supabase = createPosAdminClient();

  const { data, error } = await supabase
    .from('integrations')
    .upsert(
      { store_id: storeId, menu_source: parsed.data.menuSource, updated_at: new Date().toISOString() },
      { onConflict: 'store_id' },
    )
    .select('menu_source')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const menuSource: IntegrationMode = data.menu_source === 'pos_native' ? 'pos_native' : 'dine_live';
  return NextResponse.json({ menuSource });
});
