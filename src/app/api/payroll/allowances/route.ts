import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';
import type { PayrollAllowance } from '@/lib/pos-types';

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

// 固定手当・固定控除の一覧 (?staffId= で絞り込み)。manager以上のみ (給与情報のため)。
export const GET = withPosStaff('manager', async (_session, req) => {
  const staffId = new URL(req.url).searchParams.get('staffId');
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  let query = supabase.from('payroll_allowances').select(SELECT).eq('store_id', storeId).order('start_date');
  if (staffId) query = query.eq('staff_id', staffId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ allowances: (data ?? []).map((r) => toAllowance(r as unknown as Row)) });
});

const createSchema = z.object({
  staffId: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  kind: z.enum(['allowance', 'deduction']),
  amountUsd: z.number().min(0).max(100000),
  startDate: z.string().min(1),
  endDate: z.string().nullable().optional(),
  monthly: z.boolean().default(true),
  note: z.string().trim().max(300).nullable().optional(),
});

// 新規の固定手当・固定控除の登録。manager以上のみ。
export const POST = withPosStaff('manager', async (session, req) => {
  const json = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  // staffId が自店舗のスタッフであることを確認 (店舗を跨いだ推測アクセス防止)。
  const { data: staffRow } = await supabase.from('staff').select('id').eq('id', d.staffId).eq('store_id', storeId).maybeSingle();
  if (!staffRow) return NextResponse.json({ error: 'staff_not_found' }, { status: 404 });

  const { data, error } = await supabase
    .from('payroll_allowances')
    .insert({
      store_id: storeId,
      staff_id: d.staffId,
      name: d.name,
      kind: d.kind,
      amount_usd: d.amountUsd,
      start_date: d.startDate,
      end_date: d.endDate ?? null,
      monthly: d.monthly,
      note: d.note ?? null,
      created_by: session.staffId,
    })
    .select(SELECT)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ allowance: toAllowance(data as unknown as Row) }, { status: 201 });
});
