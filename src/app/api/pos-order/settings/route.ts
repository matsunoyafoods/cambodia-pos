import { NextResponse } from 'next/server';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { DEFAULT_SETTINGS, type PosSettings } from '@/lib/pos-types';

// レジ画面向け、POSネイティブ設定 (VAT率・サービス料率・KHRレート・決済手段) の
// 公開読み取りエンドポイント (認証なし・理由は menu/route.ts と同じ)。

type StoredSettings = Partial<Omit<PosSettings, 'storeId'>>;

export async function GET() {
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data, error } = await supabase.from('stores').select('settings').eq('id', storeId).maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const stored = (data?.settings && typeof data.settings === 'object' ? data.settings : {}) as StoredSettings;
  const settings: PosSettings = {
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
  };
  return NextResponse.json(settings);
}
