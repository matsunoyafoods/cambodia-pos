import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import {
  calculateDailyRate,
  calculateHourlyRate,
  calculatePayroll,
  calculateQuarterHourRate,
  calculateLeaveBalance,
  computeDayTimes,
  fiscalYearStartYearFor,
  type AttendanceDayForCalc,
} from './calc';
import { roundCurrencyToCents } from './rounding';
import { canAmend, canConfirm, canEditDirectly } from './run-status';

// 2026年9月 (30日、基準勤務日数26日) を標準の検証月として使う。
// 欠勤・遅刻等が無い通常月の最終支給額は、基準勤務日数の値に依存しない
// (固定給からの控除・加算項目のみで決まる) ため、どの月を使っても Tom提示の
// $360 / $395 / $465 になるはずというのが仕様の要点。
const YEAR = 2026;
const MONTH = 9;

function normalMonthDays(count = 26): AttendanceDayForCalc[] {
  return Array.from({ length: count }, () => ({
    category: 'normal' as const,
    lateMinutesRaw: 0,
    earlyLeaveMinutesRaw: 0,
    workedHours: 8.5,
  }));
}

describe('社員: 通常月 (遅刻・早退・欠勤なし)', () => {
  it('CHEK: 固定給$400 − 寮費$40 = $360', () => {
    const result = calculatePayroll({
      year: YEAR,
      month: MONTH,
      employmentType: 'employee',
      basePayUsd: 400,
      standardDailyHours: 8.5,
      monthlyHolidayDays: 4,
      days: normalMonthDays(),
      fixedAllowancesAndDeductions: [{ kind: 'deduction', amountUsd: 40 }],
      otherAllowance: 0,
      otherDeduction: 0,
    });
    expect(result.finalPay).toBe(360);
    expect(result.absenceDeduction).toBe(0);
    expect(result.latenessDeduction).toBe(0);
    expect(result.earlyLeaveDeduction).toBe(0);
  });

  it('E: 固定給$380 + ガソリン代$15 = $395', () => {
    const result = calculatePayroll({
      year: YEAR,
      month: MONTH,
      employmentType: 'employee',
      basePayUsd: 380,
      standardDailyHours: 8.5,
      monthlyHolidayDays: 4,
      days: normalMonthDays(),
      fixedAllowancesAndDeductions: [{ kind: 'allowance', amountUsd: 15 }],
      otherAllowance: 0,
      otherDeduction: 0,
    });
    expect(result.finalPay).toBe(395);
  });

  it('Ta Van: 固定給$450 + ガソリン代$15 = $465', () => {
    const result = calculatePayroll({
      year: YEAR,
      month: MONTH,
      employmentType: 'employee',
      basePayUsd: 450,
      standardDailyHours: 8.5,
      monthlyHolidayDays: 4,
      days: normalMonthDays(),
      fixedAllowancesAndDeductions: [{ kind: 'allowance', amountUsd: 15 }],
      otherAllowance: 0,
      otherDeduction: 0,
    });
    expect(result.finalPay).toBe(465);
  });
});

describe('社員: 遅刻・早退の控除', () => {
  const dailyRate = calculateDailyRate(400, 26);
  const hourlyRate = calculateHourlyRate(dailyRate, 8.5);
  const quarterHourRate = calculateQuarterHourRate(hourlyRate);

  function withLateness(lateMinutesRaw: number) {
    const days: AttendanceDayForCalc[] = [
      { category: 'normal', lateMinutesRaw, earlyLeaveMinutesRaw: 0, workedHours: 8.5 },
      ...normalMonthDays(25),
    ];
    return calculatePayroll({
      year: YEAR,
      month: MONTH,
      employmentType: 'employee',
      basePayUsd: 400,
      standardDailyHours: 8.5,
      monthlyHolidayDays: 4,
      days,
      fixedAllowancesAndDeductions: [],
      otherAllowance: 0,
      otherDeduction: 0,
    });
  }

  // 遅刻控除・欠勤控除などの「途中経過」の値は仕様上、丸めない (最終支給額のみ丸める)。
  // そのためテストでも roundCurrencyToCents は使わず、高精度の値のまま比較する。

  it('15分の遅刻 → 15分単価1回分を控除', () => {
    const result = withLateness(15);
    expect(result.lateMinutes).toBe(15);
    expect(result.latenessDeduction).toBeCloseTo(quarterHourRate.times(1).toNumber(), 9);
    expect(result.finalPay).toBe(roundCurrencyToCents(new Decimal(400).minus(quarterHourRate.times(1))));
  });

  it('30分の遅刻 → 15分単価2回分を控除', () => {
    const result = withLateness(30);
    expect(result.lateMinutes).toBe(30);
    expect(result.latenessDeduction).toBeCloseTo(quarterHourRate.times(2).toNumber(), 9);
  });

  it('45分の遅刻 → 15分単価3回分を控除', () => {
    const result = withLateness(45);
    expect(result.lateMinutes).toBe(45);
    expect(result.latenessDeduction).toBeCloseTo(quarterHourRate.times(3).toNumber(), 9);
  });

  it('7分の遅刻 (15分未満) → 切り上げで15分として控除される (既定の丸め設定)', () => {
    const result = withLateness(7);
    expect(result.lateMinutes).toBe(15);
    expect(result.latenessDeduction).toBeCloseTo(quarterHourRate.times(1).toNumber(), 9);
  });
});

describe('社員: 欠勤・所定休日', () => {
  it('1日の無給欠勤 → 日額1日分を控除', () => {
    const days: AttendanceDayForCalc[] = [
      { category: 'unpaid_absence', lateMinutesRaw: 0, earlyLeaveMinutesRaw: 0, workedHours: 0 },
      ...normalMonthDays(25),
    ];
    const result = calculatePayroll({
      year: YEAR,
      month: MONTH,
      employmentType: 'employee',
      basePayUsd: 400,
      standardDailyHours: 8.5,
      monthlyHolidayDays: 4,
      days,
      fixedAllowancesAndDeductions: [],
      otherAllowance: 0,
      otherDeduction: 0,
    });
    const dailyRate = calculateDailyRate(400, 26);
    expect(result.unpaidAbsenceDays).toBe(1);
    expect(result.absenceDeduction).toBeCloseTo(dailyRate.toNumber(), 9);
  });

  it('月4日の所定休日は控除されない', () => {
    const days: AttendanceDayForCalc[] = [
      ...Array.from({ length: 4 }, () => ({ category: 'scheduled_off' as const, lateMinutesRaw: 0, earlyLeaveMinutesRaw: 0, workedHours: 0 })),
      ...normalMonthDays(22),
    ];
    const result = calculatePayroll({
      year: YEAR,
      month: MONTH,
      employmentType: 'employee',
      basePayUsd: 400,
      standardDailyHours: 8.5,
      monthlyHolidayDays: 4,
      days,
      fixedAllowancesAndDeductions: [],
      otherAllowance: 0,
      otherDeduction: 0,
    });
    expect(result.scheduledOffDays).toBe(4);
    expect(result.scheduledOffExceeded).toBe(false);
    expect(result.finalPay).toBe(400); // 控除ゼロ
  });

  it('5日目の休みを無給欠勤にした場合 → 所定休日は4日のまま、5日目は欠勤控除される', () => {
    const days: AttendanceDayForCalc[] = [
      ...Array.from({ length: 4 }, () => ({ category: 'scheduled_off' as const, lateMinutesRaw: 0, earlyLeaveMinutesRaw: 0, workedHours: 0 })),
      { category: 'unpaid_absence', lateMinutesRaw: 0, earlyLeaveMinutesRaw: 0, workedHours: 0 },
      ...normalMonthDays(21),
    ];
    const result = calculatePayroll({
      year: YEAR,
      month: MONTH,
      employmentType: 'employee',
      basePayUsd: 400,
      standardDailyHours: 8.5,
      monthlyHolidayDays: 4,
      days,
      fixedAllowancesAndDeductions: [],
      otherAllowance: 0,
      otherDeduction: 0,
    });
    expect(result.scheduledOffDays).toBe(4);
    expect(result.scheduledOffExceeded).toBe(false);
    expect(result.unpaidAbsenceDays).toBe(1);
    expect(result.absenceDeduction).toBeGreaterThan(0);
  });

  it('所定休日が5日以上ある場合は警告フラグが立つ (誤って所定休日のまま登録したケース)', () => {
    const days: AttendanceDayForCalc[] = [
      ...Array.from({ length: 5 }, () => ({ category: 'scheduled_off' as const, lateMinutesRaw: 0, earlyLeaveMinutesRaw: 0, workedHours: 0 })),
      ...normalMonthDays(21),
    ];
    const result = calculatePayroll({
      year: YEAR,
      month: MONTH,
      employmentType: 'employee',
      basePayUsd: 400,
      standardDailyHours: 8.5,
      monthlyHolidayDays: 4,
      days,
      fixedAllowancesAndDeductions: [],
      otherAllowance: 0,
      otherDeduction: 0,
    });
    expect(result.scheduledOffExceeded).toBe(true);
  });
});

describe('Ta Van: 有給休暇', () => {
  it('有給休暇を使用した日は欠勤控除されない', () => {
    const days: AttendanceDayForCalc[] = [
      { category: 'paid_leave', lateMinutesRaw: 0, earlyLeaveMinutesRaw: 0, workedHours: 0 },
      ...normalMonthDays(25),
    ];
    const result = calculatePayroll({
      year: YEAR,
      month: MONTH,
      employmentType: 'employee',
      basePayUsd: 450,
      standardDailyHours: 8.5,
      monthlyHolidayDays: 4,
      days,
      fixedAllowancesAndDeductions: [{ kind: 'allowance', amountUsd: 15 }],
      otherAllowance: 0,
      otherDeduction: 0,
    });
    expect(result.paidLeaveDays).toBe(1);
    expect(result.unpaidAbsenceDays).toBe(0);
    expect(result.absenceDeduction).toBe(0);
    expect(result.finalPay).toBe(465); // 通常月と同額 (有給消化は支給額に影響しない)
  });

  it('有給休暇の残日数は台帳の年度内エントリの積み上げで計算される (繰越なし)', () => {
    const entries = [
      { entryType: 'grant' as const, days: 18, fiscalYearStartYear: 2026 },
      { entryType: 'use' as const, days: -1, fiscalYearStartYear: 2026 },
      { entryType: 'use' as const, days: -2, fiscalYearStartYear: 2026 },
    ];
    expect(calculateLeaveBalance(entries, 2026)).toBe(15);
  });

  it('繰越なしのため、別年度のエントリは残日数に含まれない', () => {
    const entries = [
      { entryType: 'grant' as const, days: 18, fiscalYearStartYear: 2025 },
      { entryType: 'grant' as const, days: 18, fiscalYearStartYear: 2026 },
    ];
    expect(calculateLeaveBalance(entries, 2026)).toBe(18);
  });

  it('有給年度は4月始まり: 2026-03-31は2025年度、2026-04-01は2026年度', () => {
    expect(fiscalYearStartYearFor('2026-03-31')).toBe(2025);
    expect(fiscalYearStartYearFor('2026-04-01')).toBe(2026);
  });
});

describe('アルバイト: 実働時間分のみ支給', () => {
  it('Piseth: 実際に働いた時間分だけ支給される (固定給からの控除方式にはしない)', () => {
    const hourlyRate = calculateHourlyRate(calculateDailyRate(175, 26), 8.5);
    const days: AttendanceDayForCalc[] = [
      { category: 'normal', lateMinutesRaw: 0, earlyLeaveMinutesRaw: 0, workedHours: 80 },
      { category: 'unpaid_absence', lateMinutesRaw: 0, earlyLeaveMinutesRaw: 0, workedHours: 0 },
    ];
    const result = calculatePayroll({
      year: YEAR,
      month: MONTH,
      employmentType: 'part_time',
      basePayUsd: 175,
      standardDailyHours: 8.5,
      monthlyHolidayDays: 4,
      days,
      fixedAllowancesAndDeductions: [],
      otherAllowance: 0,
      otherDeduction: 0,
    });
    // 欠勤扱いの日があっても、アルバイトは実働時間(80h)分にのみ基づいて計算される
    expect(result.absenceDeduction).toBe(0);
    expect(result.grossPay).toBeCloseTo(hourlyRate.times(80).toNumber(), 9);
    expect(result.finalPay).toBe(roundCurrencyToCents(hourlyRate.times(80)));
  });

  it('Kunthea: 実働給与から寮費$40が控除される', () => {
    const hourlyRate = calculateHourlyRate(calculateDailyRate(175, 26), 8.5);
    const days: AttendanceDayForCalc[] = [{ category: 'normal', lateMinutesRaw: 0, earlyLeaveMinutesRaw: 0, workedHours: 90 }];
    const result = calculatePayroll({
      year: YEAR,
      month: MONTH,
      employmentType: 'part_time',
      basePayUsd: 175,
      standardDailyHours: 8.5,
      monthlyHolidayDays: 4,
      days,
      fixedAllowancesAndDeductions: [{ kind: 'deduction', amountUsd: 40 }],
      otherAllowance: 0,
      otherDeduction: 0,
    });
    const expectedGross = hourlyRate.times(90);
    expect(result.finalPay).toBe(roundCurrencyToCents(expectedGross.minus(40)));
  });
});

describe('computeDayTimes: 予定/実際の時刻から実働時間・遅刻/早退を算出', () => {
  it('午前10:00-14:00、午後17:00-21:30を予定通り勤務した場合、実働8.5時間・遅刻早退なし', () => {
    const r = computeDayTimes({
      scheduledAmStart: '10:00',
      scheduledAmEnd: '14:00',
      actualAmStart: '10:00',
      actualAmEnd: '14:00',
      scheduledPmStart: '17:00',
      scheduledPmEnd: '21:30',
      actualPmStart: '17:00',
      actualPmEnd: '21:30',
    });
    expect(r.workedHours).toBe(8.5);
    expect(r.lateMinutesRaw).toBe(0);
    expect(r.earlyLeaveMinutesRaw).toBe(0);
  });

  it('午前10:07出勤 (7分遅刻)、それ以外は予定通り', () => {
    const r = computeDayTimes({
      scheduledAmStart: '10:00',
      scheduledAmEnd: '14:00',
      actualAmStart: '10:07',
      actualAmEnd: '14:00',
      scheduledPmStart: '17:00',
      scheduledPmEnd: '21:30',
      actualPmStart: '17:00',
      actualPmEnd: '21:30',
    });
    expect(r.lateMinutesRaw).toBe(7);
  });

  it('午後21:00退勤 (30分早退)', () => {
    const r = computeDayTimes({
      scheduledPmStart: '17:00',
      scheduledPmEnd: '21:30',
      actualPmStart: '17:00',
      actualPmEnd: '21:00',
    });
    expect(r.earlyLeaveMinutesRaw).toBe(30);
    expect(r.workedHours).toBe(4);
  });

  it('午前勤務のみ (午後は勤務なし) → 実働4時間として計算される', () => {
    const r = computeDayTimes({
      scheduledAmStart: '10:00',
      scheduledAmEnd: '14:00',
      actualAmStart: '10:00',
      actualAmEnd: '14:00',
    });
    expect(r.workedHours).toBe(4);
  });
});

describe('給与確定後の変更制限', () => {
  it('draft/pending_reviewは通常操作で編集可能', () => {
    expect(canEditDirectly('draft')).toBe(true);
    expect(canEditDirectly('pending_review')).toBe(true);
  });
  it('confirmedは通常操作で編集不可 (修正には別経路が必要)', () => {
    expect(canEditDirectly('confirmed')).toBe(false);
    expect(canAmend('confirmed')).toBe(true);
    expect(canAmend('draft')).toBe(false);
  });
  it('confirmedへの確定操作はdraft/pending_reviewからのみ許可', () => {
    expect(canConfirm('draft')).toBe(true);
    expect(canConfirm('pending_review')).toBe(true);
    expect(canConfirm('confirmed')).toBe(false);
  });
});
