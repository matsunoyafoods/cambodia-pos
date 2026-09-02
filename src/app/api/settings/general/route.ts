import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';
import { DEFAULT_SETTINGS, type PosSettings } from '@/lib/pos-types';

// POS ネイティブ運用店舗向けの一般設定・決済設定の永続化。
// pos.stores.settings (jsonb) を再利用する (新規マイグレーション不要)。
// dine 連携店舗は matsunoya-dine 側の /api/pos/settings (api-client.ts) が引き続き Source of Truth。

type StoredSettings = Partial<Omit<PosSettings, 'storeId'>>;

function toPosSettings(storeId: string, raw: unknown): PosSettings {
  const stored = (raw && typeof raw === 'object' ? (raw as StoredSettings) : {}) as StoredSettings;
  return {
    storeId,
    vatRate: typeof stored.vatRate === 'number' ? stored.vatRate : DEFAULT_SETTINGS.vatRate,
    vatInclusive: typeof stored.vatInclusive === 'boolean' ? stored.vatInclusive : DEFAULT_SETTINGS.vatInclusive,
    serviceRate: typeof stored.serviceRate === 'number' ? stored.serviceRate : DEFAULT_SETTINGS.serviceRate,
    khrRate: typeof stored.khrRate === 'number' ? stored.khrRate : DEFAULT_SETTINGS.khrRate,
    cashEnabled: typeof stored.cashEnabled === 'boolean' ? stored.cashEnabled : DEFAULT_SETTINGS.cashEnabled,
    qrEnabled: typeof stored.qrEnabled === 'boolean' ? stored.qrEnabled : DEFAULT_SETTINGS.qrEnabled,
    cardEnabled: typeof stored.cardEnabled === 'boolean' ? stored.cardEnabled : DEFAULT_SETTINGS.cardEnabled,
    happyHourEnabled:
      typeof stored.happyHourEnabled === 'boolean' ? stored.happyHourEnabled : DEFAULT_SETTINGS.happyHourEnabled,
    happyHourStart: typeof stored.happyHourStart === 'string' ? stored.happyHourStart : DEFAULT_SETTINGS.happyHourStart,
    happyHourEnd: typeof stored.happyHourEnd === 'string' ? stored.happyHourEnd : DEFAULT_SETTINGS.happyHourEnd,
    menuImageStyle:
      stored.menuImageStyle === 'compact' || stored.menuImageStyle === 'full'
        ? stored.menuImageStyle
        : DEFAULT_SETTINGS.menuImageStyle,
    themeColor: typeof stored.themeColor === 'string' ? stored.themeColor : DEFAULT_SETTINGS.themeColor,
  };
}

// 取得。staff 以上 (register 画面からは使わないが設定画面の表示用に閲覧は許可)。
export const GET = withPosStaff('staff', async () => {
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data, error } = await supabase.from('stores').select('settings').eq('id', storeId).maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(toPosSettings(storeId, data?.settings));
});

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const patchSchema = z.object({
  vatRate: z.number().min(0).max(100).optional(),
  vatInclusive: z.boolean().optional(),
  serviceRate: z.number().min(0).max(100).optional(),
  khrRate: z.number().positive().optional(),
  cashEnabled: z.boolean().optional(),
  qrEnabled: z.boolean().optional(),
  cardEnabled: z.boolean().optional(),
  happyHourEnabled: z.boolean().optional(),
  happyHourStart: z.string().regex(HHMM_RE, 'HH:MM 形式で入力してください').optional(),
  happyHourEnd: z.string().regex(HHMM_RE, 'HH:MM 形式で入力してください').optional(),
  menuImageStyle: z.enum(['compact', 'full']).optional(),
  themeColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, '#rrggbb 形式で指定してください')
    .nullable()
    .optional(),
});

// 更新。manager 以上のみ。
export const PATCH = withPosStaff('manager', async (_session, req) => {
  const json = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }

  const storeId = getPosStoreId();
  const supabase = createPosAdminClient();

  const { data: existing, error: readError } = await supabase
    .from('stores')
    .select('settings')
    .eq('id', storeId)
    .maybeSingle();
  if (readError) {
    return NextResponse.json({ error: readError.message }, { status: 500 });
  }

  const current = (existing?.settings && typeof existing.settings === 'object' ? existing.settings : {}) as StoredSettings;
  const merged: StoredSettings = { ...current, ...parsed.data };

  const { data, error } = await supabase
    .from('stores')
    .update({ settings: merged, updated_at: new Date().toISOString() })
    .eq('id', storeId)
    .select('settings')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(toPosSettings(storeId, data.settings));
});
