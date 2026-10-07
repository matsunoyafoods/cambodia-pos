// 「この注文は既に会計済み・取消済みです」という一括メッセージが、実際には
// 'paid' (本当に会計済み) と 'void' (取消済み) と 'awaiting_payment' (QR決済待ち、
// まだ会計は完了していない) の3状態をすべて同じ文言で返していたため、スタッフが
// 「会計済み」と誤読して混乱する事例があった (2026-10-07、T4のテーブルリセット誤操作の
// 原因調査で判明)。状態ごとに正しい文言を返す。
export function orderStatusBlockedMessage(status: string): string {
  if (status === 'paid') return 'この注文は既に会計済みです';
  if (status === 'void') return 'この注文は取消済みです';
  if (status === 'awaiting_payment') return 'この注文はQR決済待ち中です(まだ会計は完了していません)';
  return 'この注文は操作できない状態です';
}
