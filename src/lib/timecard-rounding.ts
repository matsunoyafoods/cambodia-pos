import type { TimecardRoundingSettings } from '@/lib/pos-types';

/**
 * 勤怠の丸め設定 (2026-09-01 追加)。打刻の生記録 (clockIn/clockOut) は一切変更せず、
 * 「1回の勤務の実働分数」を人件費集計の表示時にだけ丸める。無効なら元の値をそのまま返す。
 */
export function applyTimecardRounding(minutes: number, settings: TimecardRoundingSettings): number {
  if (!settings.enabled || minutes <= 0) return minutes;
  const unit = settings.unitMinutes;
  const remainder = minutes % unit;
  if (remainder === 0) return minutes;
  const down = minutes - remainder;
  const up = down + unit;
  switch (settings.direction) {
    case 'up':
      return up;
    case 'down':
      return down;
    case 'nearest':
    default:
      return remainder >= unit / 2 ? up : down;
  }
}
