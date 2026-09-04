import 'server-only';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { DEFAULT_PAYROLL_SETTINGS, type PayrollSettings } from '@/lib/pos-types';

/**
 * 給与ルール設定 (端数処理・有給ルール) の取得。他の設定系 (timecardRounding 等) と同じ
 * pos.stores.settings (jsonb) パターン。新規マイグレーション不要で後から追加・変更できる。
 */
type StoredSettings = { payrollRules?: Partial<PayrollSettings> };

export async function getPayrollSettings(): Promise<PayrollSettings> {
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();
  const { data } = await supabase.from('stores').select('settings').eq('id', storeId).maybeSingle();
  const stored = ((data?.settings as StoredSettings | null)?.payrollRules ?? {}) as Partial<PayrollSettings>;
  return { ...DEFAULT_PAYROLL_SETTINGS, ...stored };
}
