import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';
import type { PayrollCalculationSnapshot, PayrollRunStatus } from '@/lib/pos-types';
import { canAmend } from '@/lib/payroll/run-status';

type RouteContext = { params: Promise<{ id: string }> };

// 確定済み給与の修正 (理由必須)。変更前後の内容・日時・修正者・理由を payroll_run_amendments
// に記録してから calc_json を更新する。ステータスは confirmed のまま維持する
// (Tom仕様: 確定済みの給与は通常の操作では変更できない。修正時は変更前後・日時・ユーザー・
// 理由を記録する、に対応)。owner のみ (確定済み給与の修正は最も重い操作のため manager より
// 厳格にする)。
const amendSchema = z.object({
  calc: z.record(z.string(), z.unknown()), // PayrollCalculationSnapshot 全体を差し替える
  reason: z.string().trim().min(1).max(500),
});

export const POST = withPosStaff('owner', async (session, req, ctx: RouteContext) => {
  const { id } = await ctx.params;
  const json = await req.json().catch(() => null);
  const parsed = amendSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data: existing, error: readError } = await supabase
    .from('payroll_runs')
    .select('id, status, calc_json')
    .eq('id', id)
    .eq('store_id', storeId)
    .maybeSingle();
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!canAmend(existing.status as PayrollRunStatus)) {
    return NextResponse.json({ error: 'not_confirmed' }, { status: 409 });
  }

  const beforeJson = existing.calc_json as PayrollCalculationSnapshot;
  const afterJson = parsed.data.calc as unknown as PayrollCalculationSnapshot;

  await supabase.from('payroll_run_amendments').insert({
    run_id: id,
    before_json: beforeJson,
    after_json: afterJson,
    reason: parsed.data.reason,
    changed_by: session.staffId,
  });

  const { data, error } = await supabase
    .from('payroll_runs')
    .update({ calc_json: afterJson, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id, staff_id, year_month, status, calc_json, confirmed_by, confirmed_at, updated_at')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    run: {
      id: data.id,
      staffId: data.staff_id,
      yearMonth: data.year_month,
      status: data.status,
      calc: data.calc_json,
      confirmedBy: data.confirmed_by,
      confirmedAt: data.confirmed_at,
      updatedAt: data.updated_at,
    },
  });
});

// 修正履歴の取得。
export const GET = withPosStaff('manager', async (_session, _req, ctx: RouteContext) => {
  const { id } = await ctx.params;
  const supabase = createPosAdminClient();
  const { data, error } = await supabase
    .from('payroll_run_amendments')
    .select('id, run_id, before_json, after_json, reason, changed_by, changed_at')
    .eq('run_id', id)
    .order('changed_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    amendments: (data ?? []).map((a) => ({
      id: a.id,
      runId: a.run_id,
      beforeJson: a.before_json,
      afterJson: a.after_json,
      reason: a.reason,
      changedBy: a.changed_by,
      changedAt: a.changed_at,
    })),
  });
}, { deny: ['sub_manager'] });
