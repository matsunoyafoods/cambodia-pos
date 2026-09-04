import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';
import type { PayrollAllowance } from '@/lib/pos-types';

type RouteContext = { params: Promise<{ id: string }> };

const SELECT = 'id, staff_id, name, kind, amount_usd, start_date, end_date, monthly, note';

type Row = {
  id: string;
  staff_id: string;
  name: string;
  kind: 'allowance' | 'deduction';
  amount_usd: number;
  start_date: string;
  end_date: string | null;
  monthly: boolean;
  note: string | null;
};

function toAllowance(row: Row): PayrollAllowance {
  return {
    id: row.id,
    staffId: row.staff_id,
    name: row.name,
    kind: row.kind,
    amountUsd: row.amount_usd,
    startDate: row.start_date,
    endDate: row.end_date,
    monthly: row.monthly,
    note: row.note,
  };
}

const patchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  amountUsd: z.number().min(0).max(100000).optional(),
  endDate: z.string().nullable().optional(),
  monthly: z.boolean().optional(),
  note: z.string().trim().max(300).nullable().optional(),
});

// 編集 (主に「停止」= endDate を設定する運用を想定)。manager以上のみ。
export const PATCH = withPosStaff('manager', async (_session, req, ctx: RouteContext) => {
  const { id } = await ctx.params;
  const json = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (d.name !== undefined) patch.name = d.name;
  if (d.amountUsd !== undefined) patch.amount_usd = d.amountUsd;
  if (d.endDate !== undefined) patch.end_date = d.endDate;
  if (d.monthly !== undefined) patch.monthly = d.monthly;
  if (d.note !== undefined) patch.note = d.note;

  const { data, error } = await supabase
    .from('payroll_allowances')
    .update(patch)
    .eq('id', id)
    .eq('store_id', storeId)
    .select(SELECT)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ allowance: toAllowance(data as unknown as Row) });
});

// 削除。manager以上のみ。
export const DELETE = withPosStaff('manager', async (_session, _req, ctx: RouteContext) => {
  const { id } = await ctx.params;
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();
  const { error } = await supabase.from('payroll_allowances').delete().eq('id', id).eq('store_id', storeId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
});
