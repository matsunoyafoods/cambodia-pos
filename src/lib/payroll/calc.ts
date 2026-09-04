import Decimal from 'decimal.js';
import { roundCurrencyToCents, roundMinutesToUnit, standardWorkDays, type RoundingDirection } from './rounding';

/**
 * 給与計算エンジン (2026-09-04 追加、画面処理から分離した純粋関数群)。
 * Tomとの承認済み仕様に基づく。API ルート・画面のどちらからも同じ関数を呼ぶことで、
 * 表示・計算・CSV/PDF出力すべてで結果が一致することを保証する。
 *
 * 重要な確定ルール:
 * - 社員: 固定給から欠勤・遅刻・早退等を控除する方式。月4日以内の所定休日は控除しない。
 * - アルバイト: 実際に働いた時間分だけ支給する方式 (固定給からの控除ではない)。
 * - 遅刻・早退は15分単位、既定は切り上げ。
 * - 内部計算は高精度を維持し、最終支給額のみセント単位で四捨五入する。
 */

export type EmploymentType = 'employee' | 'part_time';

export type AttendanceCategory =
  | 'normal'
  | 'scheduled_off'
  | 'paid_leave'
  | 'unpaid_absence'
  | 'late'
  | 'early_leave'
  | 'half_day'
  | 'am_only'
  | 'pm_only'
  | 'other';

export type PayrollRoundingRules = {
  latenessUnitMinutes: number; // 既定15
  latenessDirection: RoundingDirection; // 既定 'up' (切り上げ)
};

export const DEFAULT_PAYROLL_ROUNDING: PayrollRoundingRules = {
  latenessUnitMinutes: 15,
  latenessDirection: 'up',
};

// ---------- 単価の算出 ----------

/** 日額 = 基準給 (固定給 or 基準月額) ÷ 基準勤務日数 */
export function calculateDailyRate(basePayUsd: number, workDaysInMonth: number): Decimal {
  if (workDaysInMonth <= 0) throw new Error('standardWorkDays must be positive');
  return new Decimal(basePayUsd).dividedBy(workDaysInMonth);
}

/** 時間単価 = 日額 ÷ 1日の所定労働時間 (既定8.5時間) */
export function calculateHourlyRate(dailyRate: Decimal, standardDailyHours: number): Decimal {
  if (standardDailyHours <= 0) throw new Error('standardDailyHours must be positive');
  return dailyRate.dividedBy(standardDailyHours);
}

/** 15分単価 = 時間単価 ÷ 4 (社員の遅刻・早退控除の基礎額) */
export function calculateQuarterHourRate(hourlyRate: Decimal): Decimal {
  return hourlyRate.dividedBy(4);
}

// ---------- 1日ごとの実働時間・遅刻/早退分数の算出 (時刻の予定 vs 実際から) ----------

export type DayTimeInput = {
  scheduledAmStart?: string | null; // 'HH:MM'
  scheduledAmEnd?: string | null;
  actualAmStart?: string | null;
  actualAmEnd?: string | null;
  scheduledPmStart?: string | null;
  scheduledPmEnd?: string | null;
  actualPmStart?: string | null;
  actualPmEnd?: string | null;
};

function toMinutes(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export type DayTimeResult = {
  /** 端数処理前の合計遅刻分数 (午前・午後の遅刻をすべて合算) */
  lateMinutesRaw: number;
  /** 端数処理前の合計早退分数 */
  earlyLeaveMinutesRaw: number;
  /** アルバイトの実働時間 (時間、休憩3時間は含まない。午前・午後の実際の時刻の差分の合計) */
  workedHours: number;
};

/**
 * 予定/実際の午前・午後の出退勤時刻から、遅刻・早退の生分数と実働時間を計算する。
 * 実際の時刻が入力されていない区間は「その区間は勤務しなかった」ものとして扱う
 * (午前のみ勤務・午後のみ勤務・半日勤務などのケースに自然に対応する)。
 * 早退は「実際の退勤が予定より早い」場合のみ計上し、逆に遅い場合 (残業) は控除にも
 * 加算にもしない (残業手当のルールは今回の仕様に含まれないため)。
 */
export function computeDayTimes(input: DayTimeInput): DayTimeResult {
  let lateMinutesRaw = 0;
  let earlyLeaveMinutesRaw = 0;
  let workedMinutes = 0;

  const segments: Array<{
    schedStart: number | null;
    schedEnd: number | null;
    actStart: number | null;
    actEnd: number | null;
  }> = [
    {
      schedStart: toMinutes(input.scheduledAmStart),
      schedEnd: toMinutes(input.scheduledAmEnd),
      actStart: toMinutes(input.actualAmStart),
      actEnd: toMinutes(input.actualAmEnd),
    },
    {
      schedStart: toMinutes(input.scheduledPmStart),
      schedEnd: toMinutes(input.scheduledPmEnd),
      actStart: toMinutes(input.actualPmStart),
      actEnd: toMinutes(input.actualPmEnd),
    },
  ];

  for (const seg of segments) {
    if (seg.actStart != null && seg.actEnd != null && seg.actEnd > seg.actStart) {
      workedMinutes += seg.actEnd - seg.actStart;
    }
    if (seg.schedStart != null && seg.actStart != null && seg.actStart > seg.schedStart) {
      lateMinutesRaw += seg.actStart - seg.schedStart;
    }
    if (seg.schedEnd != null && seg.actEnd != null && seg.actEnd < seg.schedEnd) {
      earlyLeaveMinutesRaw += seg.schedEnd - seg.actEnd;
    }
  }

  return {
    lateMinutesRaw,
    earlyLeaveMinutesRaw,
    workedHours: new Decimal(workedMinutes).dividedBy(60).toDecimalPlaces(4).toNumber(),
  };
}

// ---------- 月次集計 ----------

export type AttendanceDayForCalc = {
  category: AttendanceCategory;
  /** 端数処理前の遅刻分数 (その日の分)。事前に computeDayTimes 等で算出済みのもの、または手動入力値 */
  lateMinutesRaw: number;
  earlyLeaveMinutesRaw: number;
  /** アルバイトの実働時間 (時間) */
  workedHours: number;
};

export type MonthlyAttendanceSummary = {
  normalWorkDays: number;
  scheduledOffDays: number;
  paidLeaveDays: number;
  unpaidAbsenceDays: number;
  lateMinutesRawTotal: number;
  earlyLeaveMinutesRawTotal: number;
  workedHoursTotal: number;
};

export function summarizeMonthlyAttendance(days: AttendanceDayForCalc[]): MonthlyAttendanceSummary {
  const summary: MonthlyAttendanceSummary = {
    normalWorkDays: 0,
    scheduledOffDays: 0,
    paidLeaveDays: 0,
    unpaidAbsenceDays: 0,
    lateMinutesRawTotal: 0,
    earlyLeaveMinutesRawTotal: 0,
    workedHoursTotal: 0,
  };
  for (const day of days) {
    switch (day.category) {
      case 'scheduled_off':
        summary.scheduledOffDays += 1;
        break;
      case 'paid_leave':
        summary.paidLeaveDays += 1;
        break;
      case 'unpaid_absence':
        summary.unpaidAbsenceDays += 1;
        break;
      default:
        summary.normalWorkDays += 1;
    }
    summary.lateMinutesRawTotal += day.lateMinutesRaw;
    summary.earlyLeaveMinutesRawTotal += day.earlyLeaveMinutesRaw;
    summary.workedHoursTotal = new Decimal(summary.workedHoursTotal).plus(day.workedHours).toNumber();
  }
  return summary;
}

// ---------- 手当・控除の合計 ----------

export type AllowanceOrDeduction = { kind: 'allowance' | 'deduction'; amountUsd: number };

export function sumAllowancesAndDeductions(items: AllowanceOrDeduction[]): { allowanceTotal: Decimal; deductionTotal: Decimal } {
  let allowanceTotal = new Decimal(0);
  let deductionTotal = new Decimal(0);
  for (const item of items) {
    if (item.kind === 'allowance') allowanceTotal = allowanceTotal.plus(item.amountUsd);
    else deductionTotal = deductionTotal.plus(item.amountUsd);
  }
  return { allowanceTotal, deductionTotal };
}

// ---------- 給与計算結果 (共通の出力形) ----------

export type PayrollCalculationResult = {
  employmentType: EmploymentType;
  year: number;
  month: number;
  calendarDays: number;
  standardWorkDays: number;
  basePayUsd: number;
  /** 日額 (表示用、高精度) */
  dailyRate: number;
  /** 時間単価 (表示用、高精度) */
  hourlyRate: number;
  /** 15分単価 (社員のみ意味を持つ。アルバイトは0) */
  quarterHourRate: number;
  normalWorkDays: number;
  scheduledOffDays: number;
  paidLeaveDays: number;
  unpaidAbsenceDays: number;
  workedHours: number;
  lateMinutes: number; // 端数処理後
  earlyLeaveMinutes: number; // 端数処理後
  absenceDeduction: number;
  latenessDeduction: number;
  earlyLeaveDeduction: number;
  /** 社員: 固定給そのもの。アルバイト: 時間単価×実働時間 (アルバイト給与) */
  grossPay: number;
  fixedAllowanceTotal: number;
  fixedDeductionTotal: number;
  otherAllowance: number;
  otherDeduction: number;
  totalAllowance: number;
  totalDeduction: number;
  /** 最終支給額 (セント四捨五入した唯一の丸め済みの値) */
  finalPay: number;
  /** 月4日を超える所定休日があるか (確定前の警告用) */
  scheduledOffExceeded: boolean;
};

export type CalculatePayrollInput = {
  year: number;
  month: number;
  employmentType: EmploymentType;
  basePayUsd: number;
  standardDailyHours: number;
  monthlyHolidayDays: number; // 既定4。この日数を超える scheduledOffDays は警告対象
  days: AttendanceDayForCalc[];
  fixedAllowancesAndDeductions: AllowanceOrDeduction[];
  otherAllowance: number; // その他手当 (単発)
  otherDeduction: number; // その他控除 (単発)
  rounding?: PayrollRoundingRules;
};

export function calculatePayroll(input: CalculatePayrollInput): PayrollCalculationResult {
  const rounding = input.rounding ?? DEFAULT_PAYROLL_ROUNDING;
  const workDays = standardWorkDays(input.year, input.month);
  const dailyRate = calculateDailyRate(input.basePayUsd, workDays);
  const hourlyRate = calculateHourlyRate(dailyRate, input.standardDailyHours);
  const quarterHourRate = calculateQuarterHourRate(hourlyRate);

  const summary = summarizeMonthlyAttendance(input.days);
  const lateMinutes = roundMinutesToUnit(summary.lateMinutesRawTotal, rounding.latenessUnitMinutes, rounding.latenessDirection);
  const earlyLeaveMinutes = roundMinutesToUnit(
    summary.earlyLeaveMinutesRawTotal,
    rounding.latenessUnitMinutes,
    rounding.latenessDirection,
  );

  const { allowanceTotal: fixedAllowanceTotal, deductionTotal: fixedDeductionTotal } = sumAllowancesAndDeductions(
    input.fixedAllowancesAndDeductions,
  );

  let grossPay: Decimal;
  let absenceDeduction = new Decimal(0);
  let latenessDeduction = new Decimal(0);
  let earlyLeaveDeduction = new Decimal(0);
  let finalPay: Decimal;

  if (input.employmentType === 'employee') {
    grossPay = new Decimal(input.basePayUsd);
    absenceDeduction = dailyRate.times(summary.unpaidAbsenceDays);
    latenessDeduction = quarterHourRate.times(lateMinutes / 15);
    earlyLeaveDeduction = quarterHourRate.times(earlyLeaveMinutes / 15);
    finalPay = grossPay
      .minus(absenceDeduction)
      .minus(latenessDeduction)
      .minus(earlyLeaveDeduction)
      .minus(input.otherDeduction)
      .minus(fixedDeductionTotal)
      .plus(fixedAllowanceTotal)
      .plus(input.otherAllowance);
  } else {
    // アルバイト: 実働時間分のみ支給。固定給からの控除方式にはしない。
    grossPay = hourlyRate.times(summary.workedHoursTotal);
    finalPay = grossPay.minus(fixedDeductionTotal).minus(input.otherDeduction).plus(fixedAllowanceTotal).plus(input.otherAllowance);
  }

  return {
    employmentType: input.employmentType,
    year: input.year,
    month: input.month,
    calendarDays: workDays + 4,
    standardWorkDays: workDays,
    basePayUsd: input.basePayUsd,
    dailyRate: dailyRate.toNumber(),
    hourlyRate: hourlyRate.toNumber(),
    quarterHourRate: quarterHourRate.toNumber(),
    normalWorkDays: summary.normalWorkDays,
    scheduledOffDays: summary.scheduledOffDays,
    paidLeaveDays: summary.paidLeaveDays,
    unpaidAbsenceDays: summary.unpaidAbsenceDays,
    workedHours: summary.workedHoursTotal,
    lateMinutes,
    earlyLeaveMinutes,
    absenceDeduction: absenceDeduction.toNumber(),
    latenessDeduction: latenessDeduction.toNumber(),
    earlyLeaveDeduction: earlyLeaveDeduction.toNumber(),
    grossPay: grossPay.toNumber(),
    fixedAllowanceTotal: fixedAllowanceTotal.toNumber(),
    fixedDeductionTotal: fixedDeductionTotal.toNumber(),
    otherAllowance: input.otherAllowance,
    otherDeduction: input.otherDeduction,
    totalAllowance: fixedAllowanceTotal.plus(input.otherAllowance).toNumber(),
    totalDeduction: absenceDeduction
      .plus(latenessDeduction)
      .plus(earlyLeaveDeduction)
      .plus(fixedDeductionTotal)
      .plus(input.otherDeduction)
      .toNumber(),
    finalPay: roundCurrencyToCents(finalPay),
    scheduledOffExceeded: summary.scheduledOffDays > input.monthlyHolidayDays,
  };
}

// ---------- 有給休暇残日数の集計 (台帳の積み上げ) ----------

export type LeaveLedgerEntry = {
  entryType: 'grant' | 'use' | 'expire' | 'adjustment';
  days: number; // grant/adjustment(+) は正、use/expire は負として渡す
  fiscalYearStartYear: number;
};

/** 指定した年度 (fiscalYearStartYear) の残日数を、台帳のその年度分のエントリ合計から算出する。
 *  繰越不可の運用 (Tom確認済み) のため、年度をまたいだ合算は行わない。 */
export function calculateLeaveBalance(entries: LeaveLedgerEntry[], fiscalYearStartYear: number): number {
  const total = entries
    .filter((e) => e.fiscalYearStartYear === fiscalYearStartYear)
    .reduce((sum, e) => sum.plus(e.days), new Decimal(0));
  return total.toNumber();
}

/** 指定日が属する有給年度の起算年 (4月始まり) を返す。例: 2026-03-15 → 2025 (2025/4〜2026/3年度)。 */
export function fiscalYearStartYearFor(dateIso: string, fiscalYearStartMonth = 4): number {
  const d = new Date(`${dateIso}T00:00:00Z`);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  return m >= fiscalYearStartMonth ? y : y - 1;
}
