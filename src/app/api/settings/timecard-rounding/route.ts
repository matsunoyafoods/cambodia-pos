import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';
import { DEFAULT_TIMECARD_ROUNDING, type TimecardRoundingSettings } from '@/lib/pos-types';

// 勤怠の丸め設定 (2026-09-01 追加)。receipt-format.ts / handy-table-groups.ts と同じパターンで
// pos.stores.settings.timecardRounding (jsonb) に保存する (新規マイグレーション不要)。
// 打刻の生記録は変更せず、人件費集計 (レポート・CSV・スタッフ別画像・AI分析) の表示側だけに適用する。

type StoredSettings = { timecardRounding?: Partial<TimecardRoundingSettings> };

function toRounding(raw: unknown): TimecardRoundingSettings {
  const stored = (raw && typeof raw === 'object' ? (raw as StoredSettings).timecardRounding : undefined) ?? {};
  const unit = stored.unitMinutes;
  return {
    enabled: typeof stored.enabled === 'boolean' ? stored.enabled : DEFAULT_TIMECARD_ROUNDING.enabled,
    unitMinutes: unit === 5 || unit === 10 || unit === 15 || unit === 30 ? unit : DEFAULT_TIMECARD_ROUNDING.unitMinutes,
    direction:
      stored.direction === 'up' || stored.direction === 'down' || stored.direction === 'nearest'
        ? stored.direction
        : DEFAULT_TIMECARD_ROUNDING.direction,
  };
}

// 取得。staff 以上 (レポートを開く前提の manager 以上しか実際には使わないが、他の設定系と同様に閲覧は許可)。
export const GET = withPosStaff('staff', async () => {
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();
  const { data, error } = await supabase.from('stores').select('settings').eq('id', storeId).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(toRounding(data?.settings));
});

const patchSchema = z.object({
  enabled: z.boolean(),
  unitMinutes: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(30)]),
  direction: z.enum(['up', 'down', 'nearest']),
});

// 更新。manager 以上のみ (人件費の計算方法に関わるため)。
export const PATCH = withPosStaff('manager', async (_session, req) => {
  const json = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }

  const storeId = getPosStoreId();
  const supabase = createPosAdminClient();

  const { data: existing, error: readError } = await supabase.from('stores').select('settings').eq('id', storeId).maybeSingle();
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });

  const current = (existing?.settings && typeof existing.settings === 'object' ? existing.settings : {}) as Record<string, unknown>;
  const merged = { ...current, timecardRounding: parsed.data };

  const { error } = await supabase.from('stores').update({ settings: merged, updated_at: new Date().toISOString() }).eq('id', storeId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(parsed.data satisfies TimecardRoundingSettings);
});
