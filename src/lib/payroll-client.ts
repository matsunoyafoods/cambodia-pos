/**
 * 給与計算機能の同一オリジン API クライアント (2026-09-04 追加)。
 * staff-client.ts / timecard-client.ts と同じ POS PIN ログイン (pos_staff_session Cookie) の
 * リクエストパターンに合わせる。
 */
import type {
  PayrollAllowance,
  PayrollAttendanceDay,
  PayrollLeaveEntry,
  PayrollRun,
  PayrollRunAmendment,
  PayrollSettings,
  PayrollStaffProfile,
} from '@/lib/pos-types';

export class PayrollApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'PayrollApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      if (body?.message) message = body.message;
      else if (body?.error) message = body.error;
    } catch {
      // ignore
    }
    throw new PayrollApiError(message, res.status);
  }
  return res.json() as Promise<T>;
}

// ---------- スタッフ給与プロフィール ----------

export function listPayrollStaff(): Promise<{ staff: PayrollStaffProfile[] }> {
  return request('/api/payroll/staff');
}

export type UpdatePayrollStaffInput = Partial<{
  employmentType: 'employee' | 'part_time';
  positionTitle: string | null;
  basePayUsd: number | null;
  standardDailyHours: number;
  monthlyHolidayDays: number;
  paidLeaveEligible: boolean;
  paidLeaveAnnualDays: number;
  paidLeaveStartDate: string | null;
  hireDate: string | null;
  resignationDate: string | null;
}>;

export async function updatePayrollStaff(staffId: string, patch: UpdatePayrollStaffInput): Promise<PayrollStaffProfile> {
  const { staff } = await request<{ staff: PayrollStaffProfile }>(`/api/payroll/staff/${staffId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return staff;
}

// ---------- 固定手当・固定控除 ----------

export async function listAllowances(staffId?: string): Promise<PayrollAllowance[]> {
  const qs = staffId ? `?staffId=${encodeURIComponent(staffId)}` : '';
  const { allowances } = await request<{ allowances: PayrollAllowance[] }>(`/api/payroll/allowances${qs}`);
  return allowances;
}

export async function createAllowance(input: {
  staffId: string;
  name: string;
  kind: 'allowance' | 'deduction';
  amountUsd: number;
  startDate: string;
  endDate?: string | null;
  monthly?: boolean;
  note?: string | null;
}): Promise<PayrollAllowance> {
  const { allowance } = await request<{ allowance: PayrollAllowance }>('/api/payroll/allowances', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return allowance;
}

export async function stopAllowance(id: string, endDate: string): Promise<PayrollAllowance> {
  const { allowance } = await request<{ allowance: PayrollAllowance }>(`/api/payroll/allowances/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ endDate }),
  });
  return allowance;
}

export async function deleteAllowance(id: string): Promise<void> {
  await request(`/api/payroll/allowances/${id}`, { method: 'DELETE' });
}

// ---------- 日次勤怠 ----------

export async function getMonthlyAttendance(staffId: string, yearMonth: string): Promise<PayrollAttendanceDay[]> {
  const { days } = await request<{ days: PayrollAttendanceDay[] }>(
    `/api/payroll/attendance?staffId=${encodeURIComponent(staffId)}&yearMonth=${encodeURIComponent(yearMonth)}`,
  );
  return days;
}

export type SaveAttendanceDayInput = {
  staffId: string;
  workDate: string;
  category: PayrollAttendanceDay['category'];
  scheduledAmStart?: string | null;
  scheduledAmEnd?: string | null;
  actualAmStart?: string | null;
  actualAmEnd?: string | null;
  scheduledPmStart?: string | null;
  scheduledPmEnd?: string | null;
  actualPmStart?: string | null;
  actualPmEnd?: string | null;
  workedHoursOverride?: number | null;
  overrideReason?: string | null;
  note?: string | null;
};

export async function saveAttendanceDay(input: SaveAttendanceDayInput): Promise<PayrollAttendanceDay> {
  const { day } = await request<{ day: PayrollAttendanceDay }>('/api/payroll/attendance', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return day;
}

// ---------- 有給休暇台帳 ----------

export async function listLeaveEntries(staffId?: string): Promise<PayrollLeaveEntry[]> {
  const qs = staffId ? `?staffId=${encodeURIComponent(staffId)}` : '';
  const { entries } = await request<{ entries: PayrollLeaveEntry[] }>(`/api/payroll/leave${qs}`);
  return entries;
}

export async function createLeaveEntry(input: {
  staffId: string;
  entryType: 'grant' | 'use' | 'expire' | 'adjustment';
  entryDate: string;
  days: number;
  fiscalYearStartYear: number;
  note?: string | null;
}): Promise<PayrollLeaveEntry> {
  const { entry } = await request<{ entry: PayrollLeaveEntry }>('/api/payroll/leave', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return entry;
}

// ---------- 月次給与 (計算・確定) ----------

export async function listPayrollRuns(yearMonth: string): Promise<PayrollRun[]> {
  const { runs } = await request<{ runs: PayrollRun[] }>(`/api/payroll/runs?yearMonth=${encodeURIComponent(yearMonth)}`);
  return runs;
}

export async function calculatePayrollRun(staffId: string, yearMonth: string): Promise<PayrollRun> {
  const { run } = await request<{ run: PayrollRun }>('/api/payroll/runs', {
    method: 'POST',
    body: JSON.stringify({ staffId, yearMonth }),
  });
  return run;
}

export async function setPayrollRunStatus(runId: string, status: PayrollRun['status']): Promise<PayrollRun> {
  const { run } = await request<{ run: PayrollRun }>(`/api/payroll/runs/${runId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
  return run;
}

export async function amendPayrollRun(runId: string, calc: PayrollRun['calc'], reason: string): Promise<PayrollRun> {
  const { run } = await request<{ run: PayrollRun }>(`/api/payroll/runs/${runId}/amend`, {
    method: 'POST',
    body: JSON.stringify({ calc, reason }),
  });
  return run;
}

export async function listRunAmendments(runId: string): Promise<PayrollRunAmendment[]> {
  const { amendments } = await request<{ amendments: PayrollRunAmendment[] }>(`/api/payroll/runs/${runId}/amend`);
  return amendments;
}

// ---------- 給与ルール設定 ----------

export function getPayrollSettings(): Promise<PayrollSettings> {
  return request('/api/settings/payroll-rules');
}

export function updatePayrollSettings(settings: PayrollSettings): Promise<PayrollSettings> {
  return request('/api/settings/payroll-rules', { method: 'PATCH', body: JSON.stringify(settings) });
}
