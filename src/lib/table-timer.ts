// 滞在タイマー・飲み放題タイマーの表示用ヘルパー。
// pos.table_sessions の起点タイムスタンプから、画面表示用の経過/残り時間を計算する。

export function formatDuration(totalMinutes: number): string {
  const m = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h > 0) return `${h}時間${rem}分`;
  return `${rem}分`;
}

export function elapsedMinutes(startedAtIso: string, nowMs: number = Date.now()): number {
  const startedMs = new Date(startedAtIso).getTime();
  if (Number.isNaN(startedMs)) return 0;
  return Math.max(0, (nowMs - startedMs) / 60000);
}

export type DrinkTimerState = {
  remainingMinutes: number; // 負の値 = 超過時間
  isExpired: boolean;
  isNearExpiry: boolean; // 残り10分以内
};

export function drinkTimerState(
  drinkTimerStartedAt: string | null,
  drinkTimerMinutes: number,
  nowMs: number = Date.now(),
): DrinkTimerState | null {
  if (!drinkTimerStartedAt || drinkTimerMinutes <= 0) return null;
  const elapsed = elapsedMinutes(drinkTimerStartedAt, nowMs);
  const remainingMinutes = drinkTimerMinutes - elapsed;
  return {
    remainingMinutes,
    isExpired: remainingMinutes <= 0,
    isNearExpiry: remainingMinutes > 0 && remainingMinutes <= 10,
  };
}
