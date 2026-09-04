import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';
import type { PayrollLeaveEntry } from '@/lib/pos-types';

const SELECT = 'id, staff_id, entry_type, entry_date, days, fiscal_year_start_year, note, created_at';

type Row = {
  id: string;
  staff_id: string;
  entry_type: 'grant' | 'use' | 'expire' | 'adjustment';
  entry_date: string;
  days: number;
  fiscal_year_start_year: number;
  note: string | null;
  created_at: string;
};

function toEntry(row: Row): PayrollLeaveEntry {
  return {
    id: row.id,
    staffId: row.staff_id,
    entryType: row.entry_type,
    entryDate: row.entry_date,
    days: row.days,
    fiscalYearStartYear: row.fiscal_year_start_year,
    note: row.note,
    createdAt: row.created_at,
  };
}

// 有給休暇台帳の一覧。?staffId= で絞り込み。manager以上のみ (給与情報のため)。
export const GET = withPosStaff('manager', async (_session, req) => {
  const staffId = new URL(req.url).searchParams.get('staffId');
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  let query = supabase.from('payroll_leave_ledger').select(SELECT).eq('store_id', storeId).order('entry_date');
  if (staffId) query = query.eq('staff_id', staffId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entries: (data ?? []).map((r) => toEntry(r as unknown as Row)) });
});

const createSchema = z.object({
  staffId: z.string().uuid(),
  entryType: z.enum(['grant', 'use', 'expire', 'adjustment']),
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  days: z.number(), // grant/adjustment(+) は正、use/expire は負で渡す (呼び出し側で符号を付ける)
  fiscalYearStartYear: z.number().int(),
  note: z.string().trim().max(300).nullable().optional(),
});

// 有給休暇の付与・使用・失効・調整の登録。manager以上のみ。
// 残日数はここでは保存せず、台帳の積み上げ (src/lib/payroll/calc.ts の calculateLeaveBalance)
// から都度計算する (他の集計機能と同じく、別列に保存して同期がズレるリスクを避けるため)。
export const POST = withPosStaff('manager', async (session, req) => {
  const json = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data: staffRow } = await supabase.from('staff').select('id').eq('id', d.staffId).eq('store_id', storeId).maybeSingle();
  if (!staffRow) return NextResponse.json({ error: 'staff_not_found' }, { status: 404 });

  const { data, error } = await supabase
    .from('payroll_leave_ledger')
    .insert({
      store_id: storeId,
      staff_id: d.staffId,
      entry_type: d.entryType,
      entry_date: d.entryDate,
      days: d.days,
      fiscal_year_start_year: d.fiscalYearStartYear,
      note: d.note ?? null,
      created_by: session.staffId,
    })
    .select(SELECT)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entry: toEntry(data as unknown as Row) }, { status: 201 });
});
