import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';
import type { HandyTableGroup } from '@/lib/pos-types';

// ハンディ注文画面の卓グループ設定 (2026-08-31 追加。「ハンディで席をグループ分けできると
// いいね」)。レジ画面の見取り図とは無関係の、ハンディ専用の表示順・グループ分け設定。
// receipt-format.ts と同じパターンで pos.stores.settings.handyTableGroups (jsonb) に
// 保存する (新規マイグレーション不要)。テーブルレイアウト編集画面と同じ「ローカル編集 +
// 明示的な保存ボタン」方式に合わせ、GET は現在の設定を丸ごと返し、POST は丸ごと置き換える
// (グループ単位・メンバー単位のCRUDエンドポイントには分けない)。

type StoredSettings = { handyTableGroups?: HandyTableGroup[] };

export const GET = withPosStaff('staff', async () => {
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();
  const { data, error } = await supabase.from('stores').select('settings').eq('id', storeId).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const stored = (data?.settings && typeof data.settings === 'object' ? data.settings : {}) as StoredSettings;
  return NextResponse.json({ groups: stored.handyTableGroups ?? [] });
});

const groupSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(40),
  tableCodes: z.array(z.string().min(1)).max(200),
});

const postSchema = z.object({ groups: z.array(groupSchema).max(50) });

export const POST = withPosStaff('manager', async (_session, req) => {
  const json = await req.json().catch(() => null);
  const parsed = postSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }
  // 同じグループ内での重複だけ軽く掃除する (グループをまたいだ重複は許容 — 表示が2回
  // 出るだけで、データ破損にはならないため厳密には弾かない)。
  const groups = parsed.data.groups.map((g) => ({ ...g, tableCodes: Array.from(new Set(g.tableCodes)) }));

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
  const merged = { ...current, handyTableGroups: groups };

  const { error } = await supabase
    .from('stores')
    .update({ settings: merged, updated_at: new Date().toISOString() })
    .eq('id', storeId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, groups });
});
