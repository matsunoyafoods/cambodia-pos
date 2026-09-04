'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStaff } from './staff-context';
import { LanguageProvider, useLanguage, STAFF_LANGUAGE_STORAGE_KEY } from './language-context';
import {
  PayrollApiError,
  listPayrollStaff,
  updatePayrollStaff,
  listAllowances,
  createAllowance,
  stopAllowance,
  deleteAllowance,
  getMonthlyAttendance,
  saveAttendanceDay,
  listLeaveEntries,
  createLeaveEntry,
  listPayrollRuns,
  calculatePayrollRun,
  setPayrollRunStatus,
  amendPayrollRun,
} from '@/lib/payroll-client';
import type {
  AttendanceCategory,
  EmploymentType,
  PayrollAllowance,
  PayrollAttendanceDay,
  PayrollLeaveEntry,
  PayrollRun,
  PayrollStaffProfile,
} from '@/lib/pos-types';

// 給与計算システム (2026-09-04 追加)。Tomからの要望「スタッフごとの勤怠実績を入力すると
// 給与を自動計算できるシステム」に対応。計算ロジック本体は src/lib/payroll/calc.ts
// (画面から独立、自動テスト付き)。ここでは入力・確認・確定の画面のみを扱う。
// owner/manager限定 (給与情報のため)。

const CATEGORY_KEYS: AttendanceCategory[] = [
  'normal',
  'scheduled_off',
  'paid_leave',
  'unpaid_absence',
  'late',
  'early_leave',
  'half_day',
  'am_only',
  'pm_only',
  'other',
];

function categoryLabel(t: (key: string) => string, category: AttendanceCategory): string {
  return t(`payroll.category.${category}`);
}

function todayYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function PayrollScreen() {
  return (
    <LanguageProvider storageKey={STAFF_LANGUAGE_STORAGE_KEY} defaultLang="ja">
      <PayrollScreenInner />
    </LanguageProvider>
  );
}

type Tab = 'staff' | 'attendance' | 'leave' | 'runs';

function PayrollScreenInner() {
  const { t } = useLanguage();
  const router = useRouter();
  const me = useStaff();
  const isPosNative = me.authMode === 'pos_native';
  const canManage = isPosNative && (me.role === 'owner' || me.role === 'manager');
  const [tab, setTab] = useState<Tab>('staff');

  const [staffList, setStaffList] = useState<PayrollStaffProfile[] | null>(null);
  const [staffError, setStaffError] = useState<string | null>(null);

  const loadStaff = useCallback(() => {
    setStaffError(null);
    listPayrollStaff()
      .then(({ staff }) => setStaffList(staff))
      .catch((err) => setStaffError(err instanceof PayrollApiError ? err.message : t('common.registerError')));
  }, [t]);

  useEffect(() => {
    if (canManage) loadStaff();
  }, [canManage, loadStaff]);

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-background">
      <div className="flex flex-shrink-0 items-center gap-3 border-b border-border px-5 py-3 print:hidden">
        <button
          onClick={() => router.push('/pos')}
          className="flex h-9 items-center rounded-lg border border-border bg-card px-3 text-[13px] font-semibold"
        >
          ← {t('common.backToRegister')}
        </button>
        <div className="text-[15px] font-bold">{t('payroll.title')}</div>
      </div>

      {!isPosNative ? (
        <div className="p-5 text-[13px] text-muted-foreground">{t('common.posNativeOnlyBody')}</div>
      ) : !canManage ? (
        <div className="p-5 text-[13px] text-muted-foreground">{t('common.managerOnly')}</div>
      ) : (
        <>
          <div className="flex flex-shrink-0 gap-1.5 border-b border-border px-5 py-2 print:hidden">
            {(['staff', 'attendance', 'leave', 'runs'] as Tab[]).map((tb) => (
              <button
                key={tb}
                onClick={() => setTab(tb)}
                className={
                  'h-9 rounded-lg px-3.5 text-[12.5px] font-semibold ' +
                  (tab === tb ? 'bg-primary text-primary-foreground' : 'border border-border')
                }
              >
                {t(`payroll.tab.${tb}`)}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-auto p-5">
            <div className="mx-auto flex max-w-[980px] flex-col gap-4">
              {staffError && <div className="text-xs text-destructive">{staffError}</div>}
              {staffList === null && !staffError && <div className="text-xs text-muted-foreground">{t('common.loadingEllipsis')}</div>}
              {staffList && tab === 'staff' && <StaffProfileTab staffList={staffList} onChanged={loadStaff} />}
              {staffList && tab === 'attendance' && <AttendanceTab staffList={staffList} />}
              {staffList && tab === 'leave' && <LeaveTab staffList={staffList} />}
              {staffList && tab === 'runs' && <RunsTab staffList={staffList} />}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ================= スタッフ給与設定タブ =================

function StaffProfileTab({ staffList, onChanged }: { staffList: PayrollStaffProfile[]; onChanged: () => void }) {
  const { t } = useLanguage();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2.5">
      <div className="text-[13px] font-bold">{t('payroll.staff.heading')}</div>
      {staffList.map((s) => (
        <div key={s.id} className="rounded-xl border border-border px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[13px] font-semibold">
                {s.displayName}
                {s.active === false && ` ・ ${t('settings.staff.inactive')}`}
              </div>
              <div className="text-[11.5px] text-muted-foreground">
                {t(`payroll.employmentType.${s.employmentType}`)}
                {s.positionTitle && ` ・ ${s.positionTitle}`}
                {' ・ '}
                {s.basePayUsd != null ? `$${s.basePayUsd.toFixed(2)}` : t('payroll.staff.basePayUnset')}
              </div>
            </div>
            <button
              onClick={() => setExpandedId((v) => (v === s.id ? null : s.id))}
              className="h-8 rounded-lg border border-border px-3 text-xs font-semibold"
            >
              {expandedId === s.id ? t('common.close') : t('payroll.staff.editButton')}
            </button>
          </div>
          {expandedId === s.id && (
            <div className="mt-3 flex flex-col gap-4 border-t border-border pt-3">
              <StaffProfileEditForm
                staff={s}
                onSaved={() => {
                  onChanged();
                }}
              />
              <AllowanceManager staffId={s.id} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function StaffProfileEditForm({ staff, onSaved }: { staff: PayrollStaffProfile; onSaved: () => void }) {
  const { t } = useLanguage();
  const [employmentType, setEmploymentType] = useState<EmploymentType>(staff.employmentType);
  const [positionTitle, setPositionTitle] = useState(staff.positionTitle ?? '');
  const [basePayUsd, setBasePayUsd] = useState(staff.basePayUsd != null ? String(staff.basePayUsd) : '');
  const [standardDailyHours, setStandardDailyHours] = useState(String(staff.standardDailyHours));
  const [monthlyHolidayDays, setMonthlyHolidayDays] = useState(String(staff.monthlyHolidayDays));
  const [paidLeaveEligible, setPaidLeaveEligible] = useState(staff.paidLeaveEligible);
  const [paidLeaveAnnualDays, setPaidLeaveAnnualDays] = useState(String(staff.paidLeaveAnnualDays));
  const [paidLeaveStartDate, setPaidLeaveStartDate] = useState(staff.paidLeaveStartDate ?? '');
  const [hireDate, setHireDate] = useState(staff.hireDate ?? '');
  const [resignationDate, setResignationDate] = useState(staff.resignationDate ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await updatePayrollStaff(staff.id, {
        employmentType,
        positionTitle: positionTitle.trim() || null,
        basePayUsd: basePayUsd.trim() === '' ? null : Number(basePayUsd),
        standardDailyHours: Number(standardDailyHours),
        monthlyHolidayDays: Number(monthlyHolidayDays),
        paidLeaveEligible,
        paidLeaveAnnualDays: Number(paidLeaveAnnualDays),
        paidLeaveStartDate: paidLeaveStartDate || null,
        hireDate: hireDate || null,
        resignationDate: resignationDate || null,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof PayrollApiError ? err.message : t('common.registerError'));
    } finally {
      setSubmitting(false);
    }
  }

  const field = 'flex flex-col gap-1';
  const label = 'text-[11px] font-semibold text-muted-foreground';
  const input = 'h-9 rounded-lg border border-border px-2.5 text-[13px]';

  return (
    <form onSubmit={submit} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <div className={field}>
        <label className={label}>{t('payroll.field.employmentType')}</label>
        <select value={employmentType} onChange={(e) => setEmploymentType(e.target.value as EmploymentType)} className={input}>
          <option value="employee">{t('payroll.employmentType.employee')}</option>
          <option value="part_time">{t('payroll.employmentType.part_time')}</option>
        </select>
      </div>
      <div className={field}>
        <label className={label}>{t('payroll.field.positionTitle')}</label>
        <input value={positionTitle} onChange={(e) => setPositionTitle(e.target.value)} className={input} />
      </div>
      <div className={field}>
        <label className={label}>{t('payroll.field.basePayUsd')}</label>
        <input type="number" min="0" step="0.01" value={basePayUsd} onChange={(e) => setBasePayUsd(e.target.value)} className={input} />
      </div>
      <div className={field}>
        <label className={label}>{t('payroll.field.standardDailyHours')}</label>
        <input
          type="number"
          min="0.5"
          step="0.1"
          value={standardDailyHours}
          onChange={(e) => setStandardDailyHours(e.target.value)}
          className={input}
        />
      </div>
      <div className={field}>
        <label className={label}>{t('payroll.field.monthlyHolidayDays')}</label>
        <input
          type="number"
          min="0"
          step="1"
          value={monthlyHolidayDays}
          onChange={(e) => setMonthlyHolidayDays(e.target.value)}
          className={input}
        />
      </div>
      <div className={field}>
        <label className={label}>{t('payroll.field.hireDate')}</label>
        <input type="date" value={hireDate} onChange={(e) => setHireDate(e.target.value)} className={input} />
      </div>
      <div className={field}>
        <label className={label}>{t('payroll.field.resignationDate')}</label>
        <input type="date" value={resignationDate} onChange={(e) => setResignationDate(e.target.value)} className={input} />
      </div>
      <div className={field}>
        <label className={label}>{t('payroll.field.paidLeaveEligible')}</label>
        <label className="flex h-9 items-center gap-2 text-[13px]">
          <input type="checkbox" checked={paidLeaveEligible} onChange={(e) => setPaidLeaveEligible(e.target.checked)} />
          {t('payroll.field.paidLeaveEligibleLabel')}
        </label>
      </div>
      {paidLeaveEligible && (
        <>
          <div className={field}>
            <label className={label}>{t('payroll.field.paidLeaveAnnualDays')}</label>
            <input
              type="number"
              min="0"
              step="0.5"
              value={paidLeaveAnnualDays}
              onChange={(e) => setPaidLeaveAnnualDays(e.target.value)}
              className={input}
            />
          </div>
          <div className={field}>
            <label className={label}>{t('payroll.field.paidLeaveStartDate')}</label>
            <input type="date" value={paidLeaveStartDate} onChange={(e) => setPaidLeaveStartDate(e.target.value)} className={input} />
          </div>
        </>
      )}
      <div className="col-span-full flex items-center gap-2.5 pt-1">
        <button
          type="submit"
          disabled={submitting}
          className="h-9 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-60"
        >
          {submitting ? t('settings.staff.updatingEllipsis') : t('common.save')}
        </button>
        {error && <div className="text-xs text-destructive">{error}</div>}
      </div>
    </form>
  );
}

function AllowanceManager({ staffId }: { staffId: string }) {
  const { t } = useLanguage();
  const [items, setItems] = useState<PayrollAllowance[] | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'allowance' | 'deduction'>('allowance');
  const [amountUsd, setAmountUsd] = useState('');
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [monthly, setMonthly] = useState(true);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    listAllowances(staffId).then(setItems).catch(() => setItems([]));
  }, [staffId]);

  useEffect(() => {
    load();
  }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !amountUsd) return;
    setSubmitting(true);
    setError(null);
    try {
      await createAllowance({ staffId, name: name.trim(), kind, amountUsd: Number(amountUsd), startDate, monthly, note: note.trim() || null });
      setShowAdd(false);
      setName('');
      setAmountUsd('');
      setNote('');
      load();
    } catch (err) {
      setError(err instanceof PayrollApiError ? err.message : t('common.registerError'));
    } finally {
      setSubmitting(false);
    }
  }

  async function stop(id: string) {
    try {
      await stopAllowance(id, new Date().toISOString().slice(0, 10));
      load();
    } catch {
      // 失敗時は静かに諦める (一覧を開き直せば最新状態が見える)
    }
  }

  return (
    <div className="rounded-lg bg-secondary/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[12px] font-bold">{t('payroll.allowance.heading')}</div>
        <button onClick={() => setShowAdd((v) => !v)} className="h-7 rounded-lg border border-dashed border-brand px-2.5 text-[11px] font-semibold text-brand">
          {showAdd ? t('common.cancel') : `＋ ${t('payroll.allowance.addButton')}`}
        </button>
      </div>
      {items === null && <div className="text-[11px] text-muted-foreground">{t('common.loadingEllipsis')}</div>}
      {items?.length === 0 && <div className="text-[11px] text-muted-foreground">{t('payroll.allowance.empty')}</div>}
      <div className="flex flex-col gap-1.5">
        {items?.map((a) => {
          const stopped = a.endDate != null && a.endDate <= new Date().toISOString().slice(0, 10);
          return (
            <div key={a.id} className="flex items-center justify-between rounded-md bg-card px-2.5 py-1.5 text-[12px]">
              <div>
                <span className={a.kind === 'allowance' ? 'text-emerald-600' : 'text-destructive'}>
                  {a.kind === 'allowance' ? '+' : '−'}${a.amountUsd.toFixed(2)}
                </span>{' '}
                {a.name} {!a.monthly && `(${t('payroll.allowance.oneTime')})`}
                {stopped && ` ・ ${t('payroll.allowance.stopped')}`}
              </div>
              <div className="flex items-center gap-1.5">
                {!stopped && (
                  <button onClick={() => stop(a.id)} className="h-6 rounded border border-border px-2 text-[10.5px]">
                    {t('payroll.allowance.stopButton')}
                  </button>
                )}
                <button onClick={() => deleteAllowance(a.id).then(load)} className="h-6 rounded border border-border px-2 text-[10.5px] text-destructive">
                  {t('common.delete')}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {showAdd && (
        <form onSubmit={submit} className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-border pt-2.5">
          <input placeholder={t('payroll.allowance.namePlaceholder')} value={name} onChange={(e) => setName(e.target.value)} className="h-8 w-32 rounded-lg border border-border px-2 text-[12px]" />
          <select value={kind} onChange={(e) => setKind(e.target.value as 'allowance' | 'deduction')} className="h-8 rounded-lg border border-border px-2 text-[12px]">
            <option value="allowance">{t('payroll.allowance.kindAllowance')}</option>
            <option value="deduction">{t('payroll.allowance.kindDeduction')}</option>
          </select>
          <input type="number" min="0" step="0.01" placeholder="$" value={amountUsd} onChange={(e) => setAmountUsd(e.target.value)} className="h-8 w-24 rounded-lg border border-border px-2 text-[12px]" />
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-8 rounded-lg border border-border px-2 text-[12px]" />
          <label className="flex items-center gap-1 text-[11px]">
            <input type="checkbox" checked={monthly} onChange={(e) => setMonthly(e.target.checked)} />
            {t('payroll.allowance.monthlyLabel')}
          </label>
          <input placeholder={t('payroll.allowance.notePlaceholder')} value={note} onChange={(e) => setNote(e.target.value)} className="h-8 w-32 rounded-lg border border-border px-2 text-[12px]" />
          <button type="submit" disabled={submitting} className="h-8 rounded-lg bg-primary px-3 text-[11px] font-semibold text-primary-foreground disabled:opacity-60">
            {t('common.save')}
          </button>
          {error && <div className="text-[11px] text-destructive">{error}</div>}
        </form>
      )}
    </div>
  );
}

// ================= 勤怠入力タブ =================

function AttendanceTab({ staffList }: { staffList: PayrollStaffProfile[] }) {
  const { t } = useLanguage();
  const [staffId, setStaffId] = useState(staffList[0]?.id ?? '');
  const [yearMonth, setYearMonth] = useState(todayYearMonth());
  const [days, setDays] = useState<PayrollAttendanceDay[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const staff = staffList.find((s) => s.id === staffId);

  const load = useCallback(() => {
    if (!staffId) return;
    setError(null);
    setDays(null);
    getMonthlyAttendance(staffId, yearMonth)
      .then(setDays)
      .catch((err) => setError(err instanceof PayrollApiError ? err.message : t('common.registerError')));
  }, [staffId, yearMonth, t]);

  useEffect(() => {
    load();
  }, [load]);

  const scheduledOffCount = days?.filter((d) => d.category === 'scheduled_off').length ?? 0;
  const exceeded = staff ? scheduledOffCount > staff.monthlyHolidayDays : false;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <select value={staffId} onChange={(e) => setStaffId(e.target.value)} className="h-9 rounded-lg border border-border px-2.5 text-[13px]">
          {staffList.map((s) => (
            <option key={s.id} value={s.id}>
              {s.displayName}
            </option>
          ))}
        </select>
        <input type="month" value={yearMonth} onChange={(e) => setYearMonth(e.target.value)} className="h-9 rounded-lg border border-border px-2.5 text-[13px]" />
      </div>
      {exceeded && (
        <div className="rounded-lg border-2 border-amber-300 bg-amber-50 px-3 py-2 text-[12px] font-semibold text-amber-900">
          ⚠ {t('payroll.attendance.exceededWarning', { count: scheduledOffCount, limit: staff?.monthlyHolidayDays ?? 4 })}
        </div>
      )}
      {error && <div className="text-xs text-destructive">{error}</div>}
      {days === null && !error && <div className="text-xs text-muted-foreground">{t('common.loadingEllipsis')}</div>}
      {days && staff && (
        <div className="flex flex-col gap-2">
          {days.map((d) => (
            <AttendanceDayRow key={d.workDate} day={d} staffId={staffId} onSaved={load} />
          ))}
        </div>
      )}
    </div>
  );
}

function timeInputProps(v: string | null) {
  return { value: v ?? '' };
}

function AttendanceDayRow({ day, staffId, onSaved }: { day: PayrollAttendanceDay; staffId: string; onSaved: () => void }) {
  const { t } = useLanguage();
  const [category, setCategory] = useState<AttendanceCategory>(day.category);
  const [scheduledAmStart, setScheduledAmStart] = useState(day.scheduledAmStart ?? '');
  const [scheduledAmEnd, setScheduledAmEnd] = useState(day.scheduledAmEnd ?? '');
  const [actualAmStart, setActualAmStart] = useState(day.actualAmStart ?? '');
  const [actualAmEnd, setActualAmEnd] = useState(day.actualAmEnd ?? '');
  const [scheduledPmStart, setScheduledPmStart] = useState(day.scheduledPmStart ?? '');
  const [scheduledPmEnd, setScheduledPmEnd] = useState(day.scheduledPmEnd ?? '');
  const [actualPmStart, setActualPmStart] = useState(day.actualPmStart ?? '');
  const [actualPmEnd, setActualPmEnd] = useState(day.actualPmEnd ?? '');
  const [note, setNote] = useState(day.note ?? '');
  const [overrideOn, setOverrideOn] = useState(day.manualOverride);
  const [workedHoursOverride, setWorkedHoursOverride] = useState(day.manualOverride ? String(day.workedHours) : '');
  const [overrideReason, setOverrideReason] = useState(day.overrideReason ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const weekday = new Date(`${day.workDate}T00:00:00`).toLocaleDateString('ja-JP', { weekday: 'short' });

  async function save() {
    if (overrideOn && !overrideReason.trim()) {
      setError(t('payroll.attendance.overrideReasonRequired'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveAttendanceDay({
        staffId,
        workDate: day.workDate,
        category,
        scheduledAmStart: scheduledAmStart || null,
        scheduledAmEnd: scheduledAmEnd || null,
        actualAmStart: actualAmStart || null,
        actualAmEnd: actualAmEnd || null,
        scheduledPmStart: scheduledPmStart || null,
        scheduledPmEnd: scheduledPmEnd || null,
        actualPmStart: actualPmStart || null,
        actualPmEnd: actualPmEnd || null,
        workedHoursOverride: overrideOn ? Number(workedHoursOverride) : null,
        overrideReason: overrideOn ? overrideReason.trim() : null,
        note: note.trim() || null,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof PayrollApiError ? err.message : t('common.registerError'));
    } finally {
      setSaving(false);
    }
  }

  const timeInput = 'h-8 w-[72px] rounded border border-border px-1.5 text-[12px]';

  return (
    <div className="rounded-lg border border-border">
      <button onClick={() => setExpanded((v) => !v)} className="flex w-full items-center justify-between px-3 py-2 text-left">
        <div className="flex items-center gap-2.5 text-[12.5px]">
          <span className="w-16 font-semibold">
            {day.workDate.slice(5)} ({weekday})
          </span>
          <span className="text-muted-foreground">{categoryLabel(t, day.category)}</span>
          {day.lateMinutes > 0 && <span className="text-destructive">{t('payroll.attendance.lateBadge', { min: day.lateMinutes })}</span>}
          {day.earlyLeaveMinutes > 0 && <span className="text-destructive">{t('payroll.attendance.earlyBadge', { min: day.earlyLeaveMinutes })}</span>}
          <span className="text-muted-foreground">{t('payroll.attendance.workedHoursBadge', { hours: day.workedHours.toFixed(2) })}</span>
        </div>
        <span className="text-[11px] text-muted-foreground">{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <div className="flex flex-col gap-2.5 border-t border-border px-3 py-2.5">
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-semibold text-muted-foreground">{t('payroll.attendance.categoryLabel')}</label>
            <select value={category} onChange={(e) => setCategory(e.target.value as AttendanceCategory)} className="h-8 rounded border border-border px-2 text-[12px]">
              {CATEGORY_KEYS.map((c) => (
                <option key={c} value={c}>
                  {categoryLabel(t, c)}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <TimeField label={t('payroll.attendance.scheduledAmStart')} v={scheduledAmStart} onChange={setScheduledAmStart} cls={timeInput} />
            <TimeField label={t('payroll.attendance.scheduledAmEnd')} v={scheduledAmEnd} onChange={setScheduledAmEnd} cls={timeInput} />
            <TimeField label={t('payroll.attendance.actualAmStart')} v={actualAmStart} onChange={setActualAmStart} cls={timeInput} />
            <TimeField label={t('payroll.attendance.actualAmEnd')} v={actualAmEnd} onChange={setActualAmEnd} cls={timeInput} />
            <TimeField label={t('payroll.attendance.scheduledPmStart')} v={scheduledPmStart} onChange={setScheduledPmStart} cls={timeInput} />
            <TimeField label={t('payroll.attendance.scheduledPmEnd')} v={scheduledPmEnd} onChange={setScheduledPmEnd} cls={timeInput} />
            <TimeField label={t('payroll.attendance.actualPmStart')} v={actualPmStart} onChange={setActualPmStart} cls={timeInput} />
            <TimeField label={t('payroll.attendance.actualPmEnd')} v={actualPmEnd} onChange={setActualPmEnd} cls={timeInput} />
          </div>
          <label className="flex items-center gap-2 text-[11px]">
            <input type="checkbox" checked={overrideOn} onChange={(e) => setOverrideOn(e.target.checked)} />
            {t('payroll.attendance.manualOverrideLabel')}
          </label>
          {overrideOn && (
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                step="0.1"
                placeholder={t('payroll.attendance.workedHoursOverridePlaceholder')}
                value={workedHoursOverride}
                onChange={(e) => setWorkedHoursOverride(e.target.value)}
                className="h-8 w-24 rounded border border-border px-2 text-[12px]"
              />
              <input
                placeholder={t('payroll.attendance.overrideReasonPlaceholder')}
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                className="h-8 flex-1 rounded border border-border px-2 text-[12px]"
              />
            </div>
          )}
          <input placeholder={t('payroll.attendance.notePlaceholder')} value={note} onChange={(e) => setNote(e.target.value)} className="h-8 rounded border border-border px-2 text-[12px]" />
          <div className="flex items-center gap-2">
            <button onClick={save} disabled={saving} className="h-8 rounded-lg bg-primary px-3 text-[11.5px] font-semibold text-primary-foreground disabled:opacity-60">
              {saving ? t('settings.staff.updatingEllipsis') : t('common.save')}
            </button>
            {error && <div className="text-[11px] text-destructive">{error}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function TimeField({ label, v, onChange, cls }: { label: string; v: string; onChange: (v: string) => void; cls: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <label className="text-[10px] text-muted-foreground">{label}</label>
      <input type="time" {...timeInputProps(v || null)} onChange={(e) => onChange(e.target.value)} className={cls} />
    </div>
  );
}

// ================= 有給休暇タブ =================

function LeaveTab({ staffList }: { staffList: PayrollStaffProfile[] }) {
  const { t } = useLanguage();
  const eligible = staffList.filter((s) => s.paidLeaveEligible);
  const [staffId, setStaffId] = useState(eligible[0]?.id ?? '');
  const [entries, setEntries] = useState<PayrollLeaveEntry[] | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [entryType, setEntryType] = useState<'grant' | 'use' | 'expire' | 'adjustment'>('use');
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));
  const [days, setDays] = useState('1');
  const [fiscalYear, setFiscalYear] = useState(new Date().getFullYear());
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!staffId) return;
    listLeaveEntries(staffId).then(setEntries).catch(() => setEntries([]));
  }, [staffId]);

  useEffect(() => {
    load();
  }, [load]);

  const balance = useMemo(() => {
    return (entries ?? []).filter((e) => e.fiscalYearStartYear === fiscalYear).reduce((sum, e) => sum + e.days, 0);
  }, [entries, fiscalYear]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!staffId || !days) return;
    setSubmitting(true);
    setError(null);
    try {
      const signedDays = entryType === 'use' || entryType === 'expire' ? -Math.abs(Number(days)) : Math.abs(Number(days));
      await createLeaveEntry({ staffId, entryType, entryDate, days: signedDays, fiscalYearStartYear: fiscalYear, note: note.trim() || null });
      setShowAdd(false);
      setNote('');
      load();
    } catch (err) {
      setError(err instanceof PayrollApiError ? err.message : t('common.registerError'));
    } finally {
      setSubmitting(false);
    }
  }

  if (eligible.length === 0) {
    return <div className="text-[13px] text-muted-foreground">{t('payroll.leave.noEligibleStaff')}</div>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <select value={staffId} onChange={(e) => setStaffId(e.target.value)} className="h-9 rounded-lg border border-border px-2.5 text-[13px]">
          {eligible.map((s) => (
            <option key={s.id} value={s.id}>
              {s.displayName}
            </option>
          ))}
        </select>
        <select value={fiscalYear} onChange={(e) => setFiscalYear(Number(e.target.value))} className="h-9 rounded-lg border border-border px-2.5 text-[13px]">
          {[fiscalYear - 1, fiscalYear, fiscalYear + 1].map((y) => (
            <option key={y} value={y}>
              {t('payroll.leave.fiscalYearLabel', { year: y })}
            </option>
          ))}
        </select>
        <div className="text-[13px] font-bold">{t('payroll.leave.balance', { days: balance })}</div>
        <button onClick={() => setShowAdd((v) => !v)} className="ml-auto h-9 rounded-lg border border-dashed border-brand px-3 text-[12px] font-semibold text-brand">
          {showAdd ? t('common.cancel') : `＋ ${t('payroll.leave.addButton')}`}
        </button>
      </div>

      {showAdd && (
        <form onSubmit={submit} className="flex flex-wrap items-center gap-2 rounded-lg bg-secondary/40 p-3">
          <select value={entryType} onChange={(e) => setEntryType(e.target.value as typeof entryType)} className="h-8 rounded-lg border border-border px-2 text-[12px]">
            <option value="grant">{t('payroll.leave.type.grant')}</option>
            <option value="use">{t('payroll.leave.type.use')}</option>
            <option value="expire">{t('payroll.leave.type.expire')}</option>
            <option value="adjustment">{t('payroll.leave.type.adjustment')}</option>
          </select>
          <input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} className="h-8 rounded-lg border border-border px-2 text-[12px]" />
          <input type="number" min="0" step="0.5" value={days} onChange={(e) => setDays(e.target.value)} className="h-8 w-20 rounded-lg border border-border px-2 text-[12px]" />
          <input placeholder={t('payroll.allowance.notePlaceholder')} value={note} onChange={(e) => setNote(e.target.value)} className="h-8 w-40 rounded-lg border border-border px-2 text-[12px]" />
          <button type="submit" disabled={submitting} className="h-8 rounded-lg bg-primary px-3 text-[11.5px] font-semibold text-primary-foreground disabled:opacity-60">
            {t('common.save')}
          </button>
          {error && <div className="text-[11px] text-destructive">{error}</div>}
        </form>
      )}

      <div className="flex flex-col gap-1.5">
        {entries?.filter((e) => e.fiscalYearStartYear === fiscalYear).map((e) => (
          <div key={e.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-[12.5px]">
            <div>
              {e.entryDate} ・ {t(`payroll.leave.type.${e.entryType}`)} ・ {e.days > 0 ? `+${e.days}` : e.days}
              {e.note && ` ・ ${e.note}`}
            </div>
          </div>
        ))}
        {entries && entries.filter((e) => e.fiscalYearStartYear === fiscalYear).length === 0 && (
          <div className="text-[12px] text-muted-foreground">{t('payroll.leave.empty')}</div>
        )}
      </div>
    </div>
  );
}

// ================= 給与計算・一覧タブ =================

function RunsTab({ staffList }: { staffList: PayrollStaffProfile[] }) {
  const { t } = useLanguage();
  const [yearMonth, setYearMonth] = useState(todayYearMonth());
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [calculating, setCalculating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detailRunId, setDetailRunId] = useState<string | null>(null);

  const load = useCallback(() => {
    listPayrollRuns(yearMonth)
      .then(setRuns)
      .catch((err) => setError(err instanceof PayrollApiError ? err.message : t('common.registerError')));
  }, [yearMonth, t]);

  useEffect(() => {
    load();
  }, [load]);

  async function calc(staffId: string) {
    setCalculating(staffId);
    setError(null);
    try {
      await calculatePayrollRun(staffId, yearMonth);
      load();
    } catch (err) {
      setError(err instanceof PayrollApiError ? err.message : t('common.registerError'));
    } finally {
      setCalculating(null);
    }
  }

  async function advance(runId: string, status: PayrollRun['status']) {
    try {
      await setPayrollRunStatus(runId, status);
      load();
    } catch (err) {
      setError(err instanceof PayrollApiError ? err.message : t('common.registerError'));
    }
  }

  function exportCsv() {
    const header = [
      t('payroll.runs.csv.name'),
      t('payroll.runs.csv.employmentType'),
      t('payroll.runs.csv.basePay'),
      t('payroll.runs.csv.workedHours'),
      t('payroll.runs.csv.totalAllowance'),
      t('payroll.runs.csv.totalDeduction'),
      t('payroll.runs.csv.finalPay'),
      t('payroll.runs.csv.status'),
    ];
    const rows = runs.map((r) => [
      r.staffName,
      t(`payroll.employmentType.${r.calc.employmentType}`),
      r.calc.basePayUsd.toFixed(2),
      r.calc.workedHours.toFixed(2),
      r.calc.totalAllowance.toFixed(2),
      r.calc.totalDeduction.toFixed(2),
      r.calc.finalPay.toFixed(2),
      t(`payroll.status.${r.status}`),
    ]);
    const csv = [header, ...rows].map((cols) => cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payroll_${yearMonth}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const runByStaffId = new Map(runs.map((r) => [r.staffId, r]));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2.5 print:hidden">
        <input type="month" value={yearMonth} onChange={(e) => setYearMonth(e.target.value)} className="h-9 rounded-lg border border-border px-2.5 text-[13px]" />
        <button onClick={exportCsv} className="h-9 rounded-lg border border-border px-3 text-[12px] font-semibold">
          {t('payroll.runs.exportCsv')}
        </button>
        <button onClick={() => window.print()} className="h-9 rounded-lg border border-border px-3 text-[12px] font-semibold">
          {t('payroll.runs.print')}
        </button>
      </div>
      <div className="mb-1 text-[13px] font-bold">{t('payroll.runs.headingForMonth', { month: yearMonth })}</div>
      {error && <div className="text-xs text-destructive">{error}</div>}

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[820px] text-[12.5px]">
          <thead>
            <tr className="border-b border-border bg-secondary/50 text-left">
              <th className="px-3 py-2">{t('payroll.runs.csv.name')}</th>
              <th className="px-3 py-2">{t('payroll.runs.csv.workedHours')}</th>
              <th className="px-3 py-2">{t('payroll.runs.csv.totalAllowance')}</th>
              <th className="px-3 py-2">{t('payroll.runs.csv.totalDeduction')}</th>
              <th className="px-3 py-2">{t('payroll.runs.csv.finalPay')}</th>
              <th className="px-3 py-2">{t('payroll.runs.csv.status')}</th>
              <th className="px-3 py-2 print:hidden">{t('payroll.runs.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {staffList.map((s) => {
              const run = runByStaffId.get(s.id);
              return (
                <tr key={s.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-semibold">{s.displayName}</td>
                  <td className="px-3 py-2">{run ? run.calc.workedHours.toFixed(2) : '—'}</td>
                  <td className="px-3 py-2">{run ? `$${run.calc.totalAllowance.toFixed(2)}` : '—'}</td>
                  <td className="px-3 py-2">{run ? `$${run.calc.totalDeduction.toFixed(2)}` : '—'}</td>
                  <td className="px-3 py-2 font-bold">{run ? `$${run.calc.finalPay.toFixed(2)}` : '—'}</td>
                  <td className="px-3 py-2">{run ? t(`payroll.status.${run.status}`) : t('payroll.status.notCalculated')}</td>
                  <td className="px-3 py-2 print:hidden">
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        onClick={() => calc(s.id)}
                        disabled={calculating === s.id || run?.status === 'confirmed' || s.basePayUsd == null}
                        className="h-7 rounded border border-border px-2 text-[10.5px] disabled:opacity-50"
                      >
                        {calculating === s.id ? t('settings.staff.updatingEllipsis') : t('payroll.runs.calcButton')}
                      </button>
                      {run && (
                        <button onClick={() => setDetailRunId(detailRunId === run.id ? null : run.id)} className="h-7 rounded border border-border px-2 text-[10.5px]">
                          {t('payroll.runs.detailButton')}
                        </button>
                      )}
                      {run && run.status === 'draft' && (
                        <button onClick={() => advance(run.id, 'pending_review')} className="h-7 rounded border border-border px-2 text-[10.5px]">
                          {t('payroll.runs.toPendingReview')}
                        </button>
                      )}
                      {run && run.status === 'pending_review' && (
                        <button onClick={() => advance(run.id, 'confirmed')} className="h-7 rounded bg-primary px-2 text-[10.5px] font-semibold text-primary-foreground">
                          {t('payroll.runs.confirmButton')}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {detailRunId && runs.find((r) => r.id === detailRunId) && (
        <RunDetailPanel run={runs.find((r) => r.id === detailRunId) as PayrollRun} onAmended={load} />
      )}
    </div>
  );
}

function RunDetailPanel({ run, onAmended }: { run: PayrollRun; onAmended: () => void }) {
  const { t } = useLanguage();
  const me = useStaff();
  const c = run.calc;
  const [showAmend, setShowAmend] = useState(false);
  const [otherAllowance, setOtherAllowance] = useState(String(c.otherAllowance));
  const [otherDeduction, setOtherDeduction] = useState(String(c.otherDeduction));
  const [finalPayOverride, setFinalPayOverride] = useState(String(c.finalPay));
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows: [string, string][] = [
    [t('payroll.runs.detail.standardWorkDays'), String(c.standardWorkDays)],
    [t('payroll.runs.detail.dailyRate'), `$${c.dailyRate.toFixed(4)}`],
    [t('payroll.runs.detail.hourlyRate'), `$${c.hourlyRate.toFixed(4)}`],
    [t('payroll.runs.detail.quarterHourRate'), `$${c.quarterHourRate.toFixed(4)}`],
    [t('payroll.runs.detail.normalWorkDays'), String(c.normalWorkDays)],
    [t('payroll.runs.detail.scheduledOffDays'), String(c.scheduledOffDays)],
    [t('payroll.runs.detail.paidLeaveDays'), String(c.paidLeaveDays)],
    [t('payroll.runs.detail.unpaidAbsenceDays'), String(c.unpaidAbsenceDays)],
    [t('payroll.runs.detail.workedHours'), c.workedHours.toFixed(2)],
    [t('payroll.runs.detail.lateMinutes'), `${c.lateMinutes}${t('payroll.runs.detail.minutesSuffix')}`],
    [t('payroll.runs.detail.earlyLeaveMinutes'), `${c.earlyLeaveMinutes}${t('payroll.runs.detail.minutesSuffix')}`],
    [t('payroll.runs.detail.absenceDeduction'), `$${c.absenceDeduction.toFixed(4)}`],
    [t('payroll.runs.detail.latenessDeduction'), `$${c.latenessDeduction.toFixed(4)}`],
    [t('payroll.runs.detail.earlyLeaveDeduction'), `$${c.earlyLeaveDeduction.toFixed(4)}`],
    [t('payroll.runs.detail.grossPay'), `$${c.grossPay.toFixed(4)}`],
    [t('payroll.runs.detail.fixedAllowanceTotal'), `$${c.fixedAllowanceTotal.toFixed(2)}`],
    [t('payroll.runs.detail.fixedDeductionTotal'), `$${c.fixedDeductionTotal.toFixed(2)}`],
    [t('payroll.runs.detail.totalAllowance'), `$${c.totalAllowance.toFixed(2)}`],
    [t('payroll.runs.detail.totalDeduction'), `$${c.totalDeduction.toFixed(2)}`],
  ];

  async function submitAmend(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const newOtherAllowance = Number(otherAllowance);
      const newOtherDeduction = Number(otherDeduction);
      const updated = {
        ...c,
        otherAllowance: newOtherAllowance,
        otherDeduction: newOtherDeduction,
        totalAllowance: c.fixedAllowanceTotal + newOtherAllowance,
        totalDeduction: c.absenceDeduction + c.latenessDeduction + c.earlyLeaveDeduction + c.fixedDeductionTotal + newOtherDeduction,
        finalPay: Number(finalPayOverride),
      };
      await amendPayrollRun(run.id, updated, reason.trim());
      setShowAmend(false);
      onAmended();
    } catch (err) {
      setError(err instanceof PayrollApiError ? err.message : t('common.registerError'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-xl border border-border p-4 print:break-inside-avoid">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[13px] font-bold">
          {run.staffName} ・ {run.yearMonth} ・ {t(`payroll.status.${run.status}`)}
        </div>
        {run.status === 'confirmed' && me.role === 'owner' && (
          <button onClick={() => setShowAmend((v) => !v)} className="h-8 rounded-lg border border-destructive px-3 text-[11px] font-semibold text-destructive print:hidden">
            {showAmend ? t('common.cancel') : t('payroll.runs.amendButton')}
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[12px] sm:grid-cols-3">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between border-b border-dashed border-border py-1">
            <span className="text-muted-foreground">{label}</span>
            <span className="font-semibold">{value}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-end text-[16px] font-bold">
        {t('payroll.runs.detail.finalPay')}: ${c.finalPay.toFixed(2)}
      </div>
      {showAmend && (
        <form onSubmit={submitAmend} className="mt-3 flex flex-col gap-2 rounded-lg bg-destructive/5 p-3 print:hidden">
          <div className="text-[11px] font-semibold text-destructive">{t('payroll.runs.amendWarning')}</div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-[11px]">{t('payroll.field.otherAllowance')}</label>
            <input type="number" step="0.01" value={otherAllowance} onChange={(e) => setOtherAllowance(e.target.value)} className="h-8 w-24 rounded border border-border px-2 text-[12px]" />
            <label className="text-[11px]">{t('payroll.field.otherDeduction')}</label>
            <input type="number" step="0.01" value={otherDeduction} onChange={(e) => setOtherDeduction(e.target.value)} className="h-8 w-24 rounded border border-border px-2 text-[12px]" />
            <label className="text-[11px]">{t('payroll.runs.detail.finalPay')}</label>
            <input type="number" step="0.01" value={finalPayOverride} onChange={(e) => setFinalPayOverride(e.target.value)} className="h-8 w-24 rounded border border-border px-2 text-[12px]" />
          </div>
          <input
            placeholder={t('payroll.runs.amendReasonPlaceholder')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="h-8 rounded border border-border px-2 text-[12px]"
          />
          <div className="flex items-center gap-2">
            <button type="submit" disabled={submitting} className="h-8 rounded-lg bg-destructive px-3 text-[11.5px] font-semibold text-destructive-foreground disabled:opacity-60">
              {t('payroll.runs.amendSubmit')}
            </button>
            {error && <div className="text-[11px] text-destructive">{error}</div>}
          </div>
        </form>
      )}
    </div>
  );
}
