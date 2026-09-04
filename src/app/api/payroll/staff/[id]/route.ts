import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';
import type { PayrollStaffProfile } from '@/lib/pos-types';

type RouteContext = { params: Promise<{ id: string }> };

const SELECT =
  'id, display_name, role, active, employment_type, position_title, base_pay_usd, standard_daily_hours, ' +
  'monthly_holiday_days, paid_leave_eligible, paid_leave_annual_days, paid_leave_start_date, hire_date, resignation_date';

const patchSchema = z.object({
  employmentType: z.enum(['employee', 'part_time']).optional(),
  positionTitle: z.string().trim().max(80).nullable().optional(),
  basePayUsd: z.number().min(0).max(100000).nullable().optional(),
  standardDailyHours: z.number().min(0.5).max(24).optional(),
  monthlyHolidayDays: z.number().int().min(0).max(31).optional(),
  paidLeaveEligible: z.boolean().optional(),
  paidLeaveAnnualDays: z.number().min(0).max(365).optional(),
  paidLeaveStartDate: z.string().nullable().optional(),
  hireDate: z.string().nullable().optional(),
  resignationDate: z.string().nullable().optional(),
});

// 給与プロフィール (雇用区分・固定給・所定労働時間・月間休日数・有給設定・入社/退職日) の更新。
// manager以上のみ (Tomからの要望「スタッフ情報はハードコードせず、管理画面から追加・編集・
// 在籍/退職の変更ができるデータとして管理」に対応)。
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

  const patch: Record<string, unknown> = {};
  if (d.employmentType !== undefined) patch.employment_type = d.employmentType;
  if (d.positionTitle !== undefined) patch.position_title = d.positionTitle;
  if (d.basePayUsd !== undefined) patch.base_pay_usd = d.basePayUsd;
  if (d.standardDailyHours !== undefined) patch.standard_daily_hours = d.standardDailyHours;
  if (d.monthlyHolidayDays !== undefined) patch.monthly_holiday_days = d.monthlyHolidayDays;
  if (d.paidLeaveEligible !== undefined) patch.paid_leave_eligible = d.paidLeaveEligible;
  if (d.paidLeaveAnnualDays !== undefined) patch.paid_leave_annual_days = d.paidLeaveAnnualDays;
  if (d.paidLeaveStartDate !== undefined) patch.paid_leave_start_date = d.paidLeaveStartDate;
  if (d.hireDate !== undefined) patch.hire_date = d.hireDate;
  if (d.resignationDate !== undefined) patch.resignation_date = d.resignationDate;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('staff')
    .update(patch)
    .eq('id', id)
    .eq('store_id', storeId)
    .select(SELECT)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const row = data as unknown as {
    id: string;
    display_name: string;
    role: 'owner' | 'manager' | 'staff';
    active: boolean | null;
    employment_type: 'employee' | 'part_time';
    position_title: string | null;
    base_pay_usd: number | null;
    standard_daily_hours: number;
    monthly_holiday_days: number;
    paid_leave_eligible: boolean;
    paid_leave_annual_days: number;
    paid_leave_start_date: string | null;
    hire_date: string | null;
    resignation_date: string | null;
  };
  const staff: PayrollStaffProfile = {
    id: row.id,
    displayName: row.display_name,
    role: row.role,
    active: row.active ?? undefined,
    employmentType: row.employment_type,
    positionTitle: row.position_title,
    basePayUsd: row.base_pay_usd,
    standardDailyHours: row.standard_daily_hours,
    monthlyHolidayDays: row.monthly_holiday_days,
    paidLeaveEligible: row.paid_leave_eligible,
    paidLeaveAnnualDays: row.paid_leave_annual_days,
    paidLeaveStartDate: row.paid_leave_start_date,
    hireDate: row.hire_date,
    resignationDate: row.resignation_date,
  };
  return NextResponse.json({ staff });
}, { deny: ['sub_manager'] });
