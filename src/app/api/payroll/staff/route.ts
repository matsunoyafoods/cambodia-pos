import { NextResponse } from 'next/server';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';
import type { PayrollStaffProfile } from '@/lib/pos-types';

const SELECT =
  'id, display_name, role, active, employment_type, position_title, base_pay_usd, standard_daily_hours, ' +
  'monthly_holiday_days, paid_leave_eligible, paid_leave_annual_days, paid_leave_start_date, hire_date, resignation_date';

type Row = {
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

function toProfile(row: Row): PayrollStaffProfile {
  return {
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
}

// 給与情報を含むスタッフ一覧。給与に関わるためmanager以上のみ (/api/staff の一般情報より厳格)。
export const GET = withPosStaff('manager', async () => {
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data, error } = await supabase.from('staff').select(SELECT).eq('store_id', storeId).order('created_at');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ staff: (data ?? []).map((r) => toProfile(r as unknown as Row)) });
}, { deny: ['sub_manager'] });
