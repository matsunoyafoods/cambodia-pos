import Decimal from 'decimal.js';

/**
 * 給与計算共通の丸めユーティリティ (2026-09-04 追加)。
 *
 * Tomとの確認結果:
 * - 内部計算 (日額・時間単価・各種控除額など) は丸めず高精度を保持する。
 * - 丸めるのは「最終支給額」のみ、セント単位 (小数点2桁) で四捨五入する。
 * - 遅刻・早退は15分未満を切り上げて15分単位で控除する (端数処理方向は設定で変更可能)。
 *
 * 浮動小数点の誤差を避けるため、内部計算はすべて decimal.js の Decimal 型で行う。
 * 画面表示や JSON 化の直前にだけ Number へ変換する。
 */

export type RoundingDirection = 'up' | 'down' | 'nearest';

/** 分単位の時間 (遅刻・早退) を指定した単位・方向で丸める。0分以下はそのまま0。 */
export function roundMinutesToUnit(minutes: number, unitMinutes: number, direction: RoundingDirection): number {
  if (minutes <= 0) return 0;
  const remainder = minutes % unitMinutes;
  if (remainder === 0) return minutes;
  const down = minutes - remainder;
  const up = down + unitMinutes;
  switch (direction) {
    case 'up':
      return up;
    case 'down':
      return down;
    case 'nearest':
    default:
      return remainder >= unitMinutes / 2 ? up : down;
  }
}

/** 最終支給額のみに使う: セント単位 (小数点2桁) で四捨五入する。 */
export function roundCurrencyToCents(value: Decimal | number): number {
  const d = value instanceof Decimal ? value : new Decimal(value);
  return d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}

/** 表示用: 内部の高精度な値を、画面表示に適した桁数 (既定6桁) に丸めた number に変換する。
 *  内部の計算結果そのものは丸めない (これは表示直前の変換専用)。 */
export function toDisplayNumber(value: Decimal | number, decimalPlaces = 6): number {
  const d = value instanceof Decimal ? value : new Decimal(value);
  return d.toDecimalPlaces(decimalPlaces).toNumber();
}

/** その月の暦日数 (うるう年対応)。month は 1-12。 */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 基準勤務日数 = 暦日数 − 4 (Tom仕様: 全スタッフ月4日休み前提)。 */
export function standardWorkDays(year: number, month: number): number {
  return daysInMonth(year, month) - 4;
}
