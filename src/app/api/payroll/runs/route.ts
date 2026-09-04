import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';
import type { PayrollCalculationSnapshot, PayrollRun, PayrollRunStatus } from '@/lib/pos-types';
import { calculatePayroll, type AllowanceOrDeduction, type AttendanceCategory as CalcAttendanceCategory } from '@/lib/payroll/calc';
import { getPayrollSettings } from '@/lib/payroll/settings-server';
import { canEditDirectly } from '@/lib/payroll/run-status';

const RUN_SELECT = 'id, staff_id, year_month, status, calc_json, confirmed_by, confirmed_at, updated_at';

type RunRow = {
  id: string;
  staff_id: string;
  year_month: string;
  status: PayrollRunStatus;
  calc_json: PayrollCalculationSnapshot;
  confirmed_by: string | null;
  confirmed_at: string | null;
  updated_at: string;
};

function toRun(row: RunRow, staffName: string): PayrollRun {
  return {
    id: row.id,
    staffId: row.staff_id,
    staffName,
    yearMonth: row.year_month,
    status: row.status,
    calc: row.calc_json,
    confirmedBy: row.confirmed_by,
    confirmedAt: row.confirmed_at,
    updatedAt: row.updated_at,
  };
}

// 指定月の給与一覧。全スタッフ分 (未計算のスタッフは含まれない = 「給与計算」を実行して
// draft を作るまで一覧に出てこない)。manager以上のみ。
export const GET = withPosStaff('manager', async (_session, req) => {
  const yearMonth = new URL(req.url).searchParams.get('yearMonth');
  if (!yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data: runs, error } = await supabase
    .from('payroll_runs')
    .select(RUN_SELECT)
    .eq('store_id', storeId)
    .eq('year_month', yearMonth);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const staffIds = [...new Set((runs ?? []).map((r) => (r as RunRow).staff_id))];
  const namesById = new Map<string, string>();
  if (staffIds.length > 0) {
    const { data: staffRows } = await supabase.from('staff').select('id, display_name').in('id', staffIds);
    for (const s of staffRows ?? []) namesById.set(s.id, s.display_name);
  }

  return NextResponse.json({
    runs: (runs ?? []).map((r) => toRun(r as RunRow, namesById.get((r as RunRow).staff_id) ?? '(不明なスタッフ)')),
  });
});

function isAllowanceApplicable(a: { start_date: string; end_date: string | null; monthly: boolean }, year: number, month: number): boolean {
  const monthStart = Date.UTC(year, month - 1, 1);
  const monthEnd = Date.UTC(year, month, 0);
  const start = Date.parse(a.start_date);
  const end = a.end_date ? Date.parse(a.end_date) : null;
  if (start > monthEnd) return false;
  if (end != null && end < monthStart) return false;
  if (!a.monthly) {
    const s = new Date(a.start_date);
    return s.getUTCFullYear() === year && s.getUTCMonth() + 1 === month;
  }
  return true;
}

const calcSchema = z.object({
  staffId: z.string().uuid(),
  yearMonth: z.string().regex(/^\d{4}-\d{2}$/),
});

// 給与計算を実行し、draft (未確定) として保存する。既に draft/pending_review の run が
// あれば再計算して上書き。confirmed の場合は拒否 (§12: 確定済みは通常操作で変更不可。
// 修正するには PATCH /api/payroll/runs/[id]/amend を使う)。manager以上のみ。
export const POST = withPosStaff('manager', async (_session, req) => {
  const json = await req.json().catch(() => null);
  const parsed = calcSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }
  const { staffId, yearMonth } = parsed.data;
  const [year, month] = yearMonth.split('-').map(Number);
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data: staffRow, error: staffError } = await supabase
    .from('staff')
    .select(
      'id, display_name, employment_type, base_pay_usd, standard_daily_hours, monthly_holiday_days',
    )
    .eq('id', staffId)
    .eq('store_id', storeId)
    .maybeSingle();
  if (staffError) return NextResponse.json({ error: staffError.message }, { status: 500 });
  if (!staffRow) return NextResponse.json({ error: 'staff_not_found' }, { status: 404 });
  if (staffRow.base_pay_usd == null) {
    return NextResponse.json({ error: 'base_pay_not_set', message: '固定給または基準月額が未設定です' }, { status: 400 });
  }

  const { data: existingRun } = await supabase
    .from('payroll_runs')
    .select('id, status')
    .eq('staff_id', staffId)
    .eq('year_month', yearMonth)
    .maybeSingle();
  if (existingRun && !canEditDirectly(existingRun.status as PayrollRunStatus)) {
    return NextResponse.json({ error: 'confirmed_cannot_recalculate' }, { status: 409 });
  }

  const monthStart = `${yearMonth}-01`;
  const numDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthEnd = `${yearMonth}-${String(numDays).padStart(2, '0')}`;

  const [{ data: attendanceRows }, { data: allowanceRows }] = await Promise.all([
    supabase
      .from('payroll_attendance_days')
      .select('category, late_minutes, early_leave_minutes, worked_hours')
      .eq('staff_id', staffId)
      .gte('work_date', monthStart)
      .lte('work_date', monthEnd),
    supabase.from('payroll_allowances').select('kind, amount_usd, start_date, end_date, monthly').eq('staff_id', staffId),
  ]);

  // 保存済みの日はその内容を使う。未保存の日は「通常出勤・所定労働時間分働いた」ものとして
  // 扱う (§10: 通常の勤務時間を初期値として利用できるように、に対応。例外日だけ入力すればよい)。
  const savedByDayCount = (attendanceRows ?? []).length;
  const missingDays = numDays - savedByDayCount;
  const days = [
    ...(attendanceRows ?? []).map((r) => ({
      category: r.category as CalcAttendanceCategory,
      lateMinutesRaw: r.late_minutes as number,
      earlyLeaveMinutesRaw: r.early_leave_minutes as number,
      workedHours: r.worked_hours as number,
    })),
    ...Array.from({ length: Math.max(0, missingDays) }, () => ({
      category: 'normal' as CalcAttendanceCategory,
      lateMinutesRaw: 0,
      earlyLeaveMinutesRaw: 0,
      workedHours: staffRow.standard_daily_hours as number,
    })),
  ];

  const fixedAllowancesAndDeductions: AllowanceOrDeduction[] = (allowanceRows ?? [])
    .filter((a) => isAllowanceApplicable(a as { start_date: string; end_date: string | null; monthly: boolean }, year, month))
    .map((a) => ({ kind: a.kind as 'allowance' | 'deduction', amountUsd: a.amount_usd as number }));

  const rounding = await getPayrollSettings();
  const calc = calculatePayroll({
    year,
    month,
    employmentType: staffRow.employment_type as 'employee' | 'part_time',
    basePayUsd: staffRow.base_pay_usd as number,
    standardDailyHours: staffRow.standard_daily_hours as number,
    monthlyHolidayDays: staffRow.monthly_holiday_days as number,
    days,
    fixedAllowancesAndDeductions,
    otherAllowance: 0,
    otherDeduction: 0,
    rounding: { latenessUnitMinutes: rounding.latenessUnitMinutes, latenessDirection: rounding.latenessDirection },
  });

  const { data: saved, error } = await supabase
    .from('payroll_runs')
    .upsert(
      {
        store_id: storeId,
        staff_id: staffId,
        year_month: yearMonth,
        status: 'draft',
        calc_json: calc,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'staff_id,year_month' },
    )
    .select(RUN_SELECT)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ run: toRun(saved as RunRow, staffRow.display_name as string) });
});
