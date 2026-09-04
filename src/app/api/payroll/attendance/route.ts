import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';
import type { AttendanceCategory, PayrollAttendanceDay } from '@/lib/pos-types';
import { computeDayTimes } from '@/lib/payroll/calc';
import { roundMinutesToUnit } from '@/lib/payroll/rounding';
import { getPayrollSettings } from '@/lib/payroll/settings-server';
import { daysInMonth as calcDaysInMonth } from '@/lib/payroll/rounding';

// 松之屋フーズの既定シフト (Tom仕様: 午前10:00-14:00、休憩14:00-17:00、午後17:00-21:30)。
// スタッフ管理で個別の所定労働時間を設定できるが、時刻そのもの(何時始業か)は今回は
// 店舗共通の1パターンのみとする (複数シフトパターンの要望が出れば別途拡張)。
const DEFAULT_SCHEDULE = {
  amStart: '10:00',
  amEnd: '14:00',
  pmStart: '17:00',
  pmEnd: '21:30',
};

const ATTENDANCE_SELECT =
  'id, staff_id, work_date, category, scheduled_am_start, scheduled_am_end, actual_am_start, actual_am_end, ' +
  'scheduled_pm_start, scheduled_pm_end, actual_pm_start, actual_pm_end, late_minutes, early_leave_minutes, ' +
  'worked_hours, manual_override, override_reason, note, source, edited_by, edited_at';

type Row = {
  id: string;
  staff_id: string;
  work_date: string;
  category: AttendanceCategory;
  scheduled_am_start: string | null;
  scheduled_am_end: string | null;
  actual_am_start: string | null;
  actual_am_end: string | null;
  scheduled_pm_start: string | null;
  scheduled_pm_end: string | null;
  actual_pm_start: string | null;
  actual_pm_end: string | null;
  late_minutes: number;
  early_leave_minutes: number;
  worked_hours: number;
  manual_override: boolean;
  override_reason: string | null;
  note: string | null;
  source: 'manual' | 'timecard_import';
  edited_by: string | null;
  edited_at: string | null;
};

function trimTime(t: string | null): string | null {
  // Postgres time 型は 'HH:MM:SS' で返る。UI は 'HH:MM' で扱う。
  if (!t) return null;
  return t.slice(0, 5);
}

function toDay(row: Row): PayrollAttendanceDay {
  return {
    id: row.id,
    staffId: row.staff_id,
    workDate: row.work_date,
    category: row.category,
    scheduledAmStart: trimTime(row.scheduled_am_start),
    scheduledAmEnd: trimTime(row.scheduled_am_end),
    actualAmStart: trimTime(row.actual_am_start),
    actualAmEnd: trimTime(row.actual_am_end),
    scheduledPmStart: trimTime(row.scheduled_pm_start),
    scheduledPmEnd: trimTime(row.scheduled_pm_end),
    actualPmStart: trimTime(row.actual_pm_start),
    actualPmEnd: trimTime(row.actual_pm_end),
    lateMinutes: row.late_minutes,
    earlyLeaveMinutes: row.early_leave_minutes,
    workedHours: row.worked_hours,
    manualOverride: row.manual_override,
    overrideReason: row.override_reason,
    note: row.note,
    source: row.source,
    editedBy: row.edited_by,
    editedAt: row.edited_at,
  };
}

function hhmm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 打刻記録 (pos.timecards) から、その日の実際の午前/午後の出退勤時刻を推測する
 *  (ベストエフォート。休憩1回目の開始/最後の休憩の終了を14:00-17:00の休憩とみなす)。
 *  値は初期値として使われるだけで、給与担当者は自由に上書きできる。 */
function guessActualFromTimecard(tc: { clock_in: string; clock_out: string | null; breaks: { startedAt: string; endedAt: string | null }[] }) {
  const clockInTime = hhmm(tc.clock_in);
  const clockOutTime = tc.clock_out ? hhmm(tc.clock_out) : null;
  const firstBreakStart = tc.breaks[0]?.startedAt ? hhmm(tc.breaks[0].startedAt) : null;
  const lastBreakEnd = tc.breaks.length > 0 ? tc.breaks[tc.breaks.length - 1].endedAt : null;
  const lastBreakEndTime = lastBreakEnd ? hhmm(lastBreakEnd) : null;

  return {
    actualAmStart: clockInTime < '14:00' ? clockInTime : null,
    actualAmEnd: firstBreakStart ?? (clockOutTime && clockOutTime <= '14:00' ? clockOutTime : null),
    actualPmStart: lastBreakEndTime ?? (clockInTime >= '14:00' ? clockInTime : null),
    actualPmEnd: clockOutTime && clockOutTime > '14:00' ? clockOutTime : null,
  };
}

// 対象月の日次勤怠一覧。DBに保存済みの日はそのまま返し、未保存の日は既定シフト + 打刻データ
// (取得できれば) を初期値として仮生成して返す (まだ保存はしない。保存はPOSTで行う)。
export const GET = withPosStaff('manager', async (_session, req) => {
  const url = new URL(req.url);
  const staffId = url.searchParams.get('staffId');
  const yearMonth = url.searchParams.get('yearMonth'); // 'YYYY-MM'
  if (!staffId || !yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  const [year, month] = yearMonth.split('-').map(Number);
  const numDays = calcDaysInMonth(year, month);
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const monthStart = `${yearMonth}-01`;
  const monthEnd = `${yearMonth}-${String(numDays).padStart(2, '0')}`;

  const [{ data: existingRows, error: existingError }, { data: timecardRows, error: timecardError }] = await Promise.all([
    supabase
      .from('payroll_attendance_days')
      .select(ATTENDANCE_SELECT)
      .eq('staff_id', staffId)
      .gte('work_date', monthStart)
      .lte('work_date', monthEnd),
    supabase
      .from('timecards')
      .select('clock_in, clock_out, breaks')
      .eq('staff_id', staffId)
      .gte('clock_in', `${monthStart}T00:00:00`)
      .lt('clock_in', `${monthEnd}T23:59:59.999`),
  ]);
  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });
  if (timecardError) return NextResponse.json({ error: timecardError.message }, { status: 500 });

  const byDate = new Map<string, Row>();
  for (const r of existingRows ?? []) byDate.set((r as unknown as Row).work_date, r as unknown as Row);

  const timecardByDate = new Map<string, { clock_in: string; clock_out: string | null; breaks: { startedAt: string; endedAt: string | null }[] }>();
  for (const tc of timecardRows ?? []) {
    const date = (tc.clock_in as string).slice(0, 10);
    if (!timecardByDate.has(date)) timecardByDate.set(date, tc as never); // 1日1件目のみ採用 (複数シフトは今回未対応)
  }

  const days: PayrollAttendanceDay[] = [];
  for (let d = 1; d <= numDays; d++) {
    const workDate = `${yearMonth}-${String(d).padStart(2, '0')}`;
    const existing = byDate.get(workDate);
    if (existing) {
      days.push(toDay(existing));
      continue;
    }
    const tc = timecardByDate.get(workDate);
    const guessed = tc ? guessActualFromTimecard(tc) : { actualAmStart: null, actualAmEnd: null, actualPmStart: null, actualPmEnd: null };
    days.push({
      id: `virtual:${staffId}:${workDate}`,
      staffId,
      workDate,
      category: 'normal',
      scheduledAmStart: DEFAULT_SCHEDULE.amStart,
      scheduledAmEnd: DEFAULT_SCHEDULE.amEnd,
      actualAmStart: guessed.actualAmStart,
      actualAmEnd: guessed.actualAmEnd,
      scheduledPmStart: DEFAULT_SCHEDULE.pmStart,
      scheduledPmEnd: DEFAULT_SCHEDULE.pmEnd,
      actualPmStart: guessed.actualPmStart,
      actualPmEnd: guessed.actualPmEnd,
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      workedHours: 0,
      manualOverride: false,
      overrideReason: null,
      note: null,
      source: tc ? 'timecard_import' : 'manual',
      editedBy: null,
      editedAt: null,
    });
  }

  return NextResponse.json({ storeId, days });
}, { deny: ['sub_manager'] });

const upsertSchema = z.object({
  staffId: z.string().uuid(),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category: z.enum(['normal', 'scheduled_off', 'paid_leave', 'unpaid_absence', 'late', 'early_leave', 'half_day', 'am_only', 'pm_only', 'other']),
  scheduledAmStart: z.string().nullable().optional(),
  scheduledAmEnd: z.string().nullable().optional(),
  actualAmStart: z.string().nullable().optional(),
  actualAmEnd: z.string().nullable().optional(),
  scheduledPmStart: z.string().nullable().optional(),
  scheduledPmEnd: z.string().nullable().optional(),
  actualPmStart: z.string().nullable().optional(),
  actualPmEnd: z.string().nullable().optional(),
  /** 実労働時間を自動計算値ではなく手動で上書きする場合に指定。指定時は理由が必須。 */
  workedHoursOverride: z.number().min(0).max(24).nullable().optional(),
  overrideReason: z.string().trim().max(300).nullable().optional(),
  note: z.string().trim().max(300).nullable().optional(),
});

// 1日分の勤怠を保存 (新規作成 or 上書き)。保存の都度、変更前後を history に記録する。
// manager以上のみ (給与に直結するため)。
export const POST = withPosStaff('manager', async (session, req) => {
  const json = await req.json().catch(() => null);
  const parsed = upsertSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;
  if (d.workedHoursOverride != null && !d.overrideReason) {
    return NextResponse.json({ error: 'override_reason_required' }, { status: 400 });
  }

  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data: staffRow } = await supabase.from('staff').select('id').eq('id', d.staffId).eq('store_id', storeId).maybeSingle();
  if (!staffRow) return NextResponse.json({ error: 'staff_not_found' }, { status: 404 });

  const rounding = await getPayrollSettings();
  const computed = computeDayTimes({
    scheduledAmStart: d.scheduledAmStart,
    scheduledAmEnd: d.scheduledAmEnd,
    actualAmStart: d.actualAmStart,
    actualAmEnd: d.actualAmEnd,
    scheduledPmStart: d.scheduledPmStart,
    scheduledPmEnd: d.scheduledPmEnd,
    actualPmStart: d.actualPmStart,
    actualPmEnd: d.actualPmEnd,
  });
  const lateMinutes = roundMinutesToUnit(computed.lateMinutesRaw, rounding.latenessUnitMinutes, rounding.latenessDirection);
  const earlyLeaveMinutes = roundMinutesToUnit(computed.earlyLeaveMinutesRaw, rounding.latenessUnitMinutes, rounding.latenessDirection);
  const workedHours = d.workedHoursOverride ?? computed.workedHours;
  const manualOverride = d.workedHoursOverride != null;

  const { data: before } = await supabase
    .from('payroll_attendance_days')
    .select(ATTENDANCE_SELECT)
    .eq('staff_id', d.staffId)
    .eq('work_date', d.workDate)
    .maybeSingle();

  const patch = {
    store_id: storeId,
    staff_id: d.staffId,
    work_date: d.workDate,
    category: d.category,
    scheduled_am_start: d.scheduledAmStart ?? null,
    scheduled_am_end: d.scheduledAmEnd ?? null,
    actual_am_start: d.actualAmStart ?? null,
    actual_am_end: d.actualAmEnd ?? null,
    scheduled_pm_start: d.scheduledPmStart ?? null,
    scheduled_pm_end: d.scheduledPmEnd ?? null,
    actual_pm_start: d.actualPmStart ?? null,
    actual_pm_end: d.actualPmEnd ?? null,
    late_minutes: lateMinutes,
    early_leave_minutes: earlyLeaveMinutes,
    worked_hours: workedHours,
    manual_override: manualOverride,
    override_reason: manualOverride ? d.overrideReason : null,
    note: d.note ?? null,
    source: 'manual' as const,
    edited_by: session.staffId,
    edited_at: new Date().toISOString(),
  };

  const { data: savedRaw, error } = await supabase
    .from('payroll_attendance_days')
    .upsert(patch, { onConflict: 'staff_id,work_date' })
    .select(ATTENDANCE_SELECT)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const saved = savedRaw as unknown as Row;

  await supabase.from('payroll_attendance_day_history').insert({
    attendance_day_id: saved.id,
    before_json: before ?? null,
    after_json: saved,
    reason: d.overrideReason ?? null,
    changed_by: session.staffId,
  });

  return NextResponse.json({ day: toDay(saved) });
}, { deny: ['sub_manager'] });
