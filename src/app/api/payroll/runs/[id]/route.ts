import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';
import type { PayrollCalculationSnapshot, PayrollRunStatus } from '@/lib/pos-types';
import { canConfirm, canEditDirectly } from '@/lib/payroll/run-status';

type RouteContext = { params: Promise<{ id: string }> };

const RUN_SELECT = 'id, staff_id, year_month, status, calc_json, confirmed_by, confirmed_at, updated_at';

const patchSchema = z.object({
  status: z.enum(['draft', 'pending_review', 'confirmed']),
});

// ステータス遷移 (編集中→確認待ち→確定済み)。確定済みへの遷移時は confirmed_by/confirmed_at
// を記録する。確定済みからの直接変更は拒否 (§12: 修正は /amend を使う)。manager以上のみ。
export const PATCH = withPosStaff('manager', async (session, req, ctx: RouteContext) => {
  const { id } = await ctx.params;
  const json = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data: existing, error: readError } = await supabase
    .from('payroll_runs')
    .select('id, status')
    .eq('id', id)
    .eq('store_id', storeId)
    .maybeSingle();
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const currentStatus = existing.status as PayrollRunStatus;
  const nextStatus = parsed.data.status;

  if (!canEditDirectly(currentStatus)) {
    return NextResponse.json({ error: 'confirmed_cannot_change_directly' }, { status: 409 });
  }
  if (nextStatus === 'confirmed' && !canConfirm(currentStatus)) {
    return NextResponse.json({ error: 'cannot_confirm' }, { status: 409 });
  }

  const patch: Record<string, unknown> = { status: nextStatus, updated_at: new Date().toISOString() };
  if (nextStatus === 'confirmed') {
    patch.confirmed_by = session.staffId;
    patch.confirmed_at = new Date().toISOString();
  }

  const { data, error } = await supabase.from('payroll_runs').update(patch).eq('id', id).select(RUN_SELECT).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const row = data as {
    id: string;
    staff_id: string;
    year_month: string;
    status: PayrollRunStatus;
    calc_json: PayrollCalculationSnapshot;
    confirmed_by: string | null;
    confirmed_at: string | null;
    updated_at: string;
  };
  return NextResponse.json({
    run: {
      id: row.id,
      staffId: row.staff_id,
      yearMonth: row.year_month,
      status: row.status,
      calc: row.calc_json,
      confirmedBy: row.confirmed_by,
      confirmedAt: row.confirmed_at,
      updatedAt: row.updated_at,
    },
  });
}, { deny: ['sub_manager'] });
