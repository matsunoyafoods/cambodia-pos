import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';
import type { PayrollSettings } from '@/lib/pos-types';
import { getPayrollSettings } from '@/lib/payroll/settings-server';

// 給与ルール設定 (端数処理・有給ルール、2026-09-04追加)。timecardRounding と同じ
// pos.stores.settings (jsonb) パターン。取得は manager以上、変更もmanager以上
// (給与計算方法に関わるため)。

export const GET = withPosStaff('manager', async () => {
  const settings = await getPayrollSettings();
  return NextResponse.json(settings);
});

const patchSchema = z.object({
  latenessUnitMinutes: z.union([z.literal(5), z.literal(10), z.literal(15)]),
  latenessDirection: z.enum(['up', 'down', 'nearest']),
  leaveGrantMethod: z.enum(['lump_sum', 'monthly_accrual']),
  leaveUsageUnit: z.enum(['day', 'half_day', 'hour']),
  leaveCarryover: z.enum(['none', 'unlimited', 'capped']),
  leaveCarryoverCapDays: z.number().min(0).max(365).nullable(),
  leaveFiscalYearStartMonth: z.number().int().min(1).max(12),
});

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
  const merged = { ...current, payrollRules: parsed.data };

  const { error } = await supabase.from('stores').update({ settings: merged, updated_at: new Date().toISOString() }).eq('id', storeId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(parsed.data satisfies PayrollSettings);
});
