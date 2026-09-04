// 滞在タイマー・飲み放題タイマーの表示用ヘルパー。
// pos.table_sessions の起点タイムスタンプから、画面表示用の経過/残り時間を計算する。

// 「○時間○分」のような言語依存の単位表記ではなく、H:MM形式 (世界共通の時間表記) で返す。
// 多言語対応 (2026-09-04): カンボジア語UI等で漢字の「時間」「分」がそのまま表示されてしまう
// 問題への対応。翻訳ではなく、そもそも言語に依存しない数字表記に変更した。
export function formatDuration(totalMinutes: number): string {
  const m = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return `${h}:${String(rem).padStart(2, '0')}`;
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
