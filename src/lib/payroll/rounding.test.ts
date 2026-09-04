import { describe, expect, it } from 'vitest';
import { daysInMonth, roundCurrencyToCents, roundMinutesToUnit, standardWorkDays } from './rounding';

describe('daysInMonth / standardWorkDays', () => {
  it('31日の月 (2026年8月)', () => {
    expect(daysInMonth(2026, 8)).toBe(31);
    expect(standardWorkDays(2026, 8)).toBe(27);
  });
  it('30日の月 (2026年9月)', () => {
    expect(daysInMonth(2026, 9)).toBe(30);
    expect(standardWorkDays(2026, 9)).toBe(26);
  });
  it('28日の月 (2026年2月、うるう年ではない)', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(standardWorkDays(2026, 2)).toBe(24);
  });
  it('29日の月 (2024年2月、うるう年)', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(standardWorkDays(2024, 2)).toBe(25);
  });
});

describe('roundMinutesToUnit (15分単位)', () => {
  it('0分はそのまま0', () => {
    expect(roundMinutesToUnit(0, 15, 'up')).toBe(0);
  });
  it('切り上げ: 7分 → 15分', () => {
    expect(roundMinutesToUnit(7, 15, 'up')).toBe(15);
  });
  it('切り上げ: 15分ちょうど → 15分のまま', () => {
    expect(roundMinutesToUnit(15, 15, 'up')).toBe(15);
  });
  it('切り上げ: 16分 → 30分', () => {
    expect(roundMinutesToUnit(16, 15, 'up')).toBe(30);
  });
  it('切り捨て: 7分 → 0分', () => {
    expect(roundMinutesToUnit(7, 15, 'down')).toBe(0);
  });
  it('切り捨て: 20分 → 15分', () => {
    expect(roundMinutesToUnit(20, 15, 'down')).toBe(15);
  });
  it('四捨五入: 7分 (7.5未満) → 0分', () => {
    expect(roundMinutesToUnit(7, 15, 'nearest')).toBe(0);
  });
  it('四捨五入: 8分 (7.5以上) → 15分', () => {
    expect(roundMinutesToUnit(8, 15, 'nearest')).toBe(15);
  });
});

describe('roundCurrencyToCents (最終支給額のみに使う丸め)', () => {
  it('セント未満を四捨五入する', () => {
    expect(roundCurrencyToCents(395.005)).toBe(395.01);
    expect(roundCurrencyToCents(395.004)).toBe(395.0);
  });
  it('浮動小数点の典型的な誤差が出ない (0.1+0.2型)', () => {
    expect(roundCurrencyToCents(360.1 + 0.2)).toBe(360.3);
  });
});
