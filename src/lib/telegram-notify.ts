import 'server-only';

// 予約が入ったらTelegramの指定グループへ通知する (2026-09-02 追加)。
// Tom「予約を完了した時にテレグラムのグループに予約詳細が送られるといいね」への対応。
//
// matsunoya-dineアプリ経由の予約 (public.reservations) はアプリ側で既に通知が飛んでいる
// (Tom確認済み: 「アプリはすでに予約が入ったら通知がいくようになってる」) ため、ここでは
// POSで直接受け付けた電話予約 (pos.reservations、/pos/reservations の受付ウィザード) のみを
// 対象にする。
//
// 通知用に新しい専用のTelegram Botを作成する方針(Tom確認済み)。環境変数
// TELEGRAM_RESERVATION_BOT_TOKEN / TELEGRAM_RESERVATION_CHAT_ID が未設定の間 (Tomが
// BotFatherでBotを作成しグループに追加するまで、および D-簡易で複製される他店舗でまだ
// 設定していない間) は何もしない — 設定が無いことをエラーにはしない。
//
// 通知の成否で予約の受付自体を失敗させないよう、呼び出し側では await せず
// `.catch(() => {})` で fire-and-forget する想定 (この関数自体も内部で例外を握りつぶす)。

const TYPE_LABEL: Record<string, string> = {
  normal: '通常予約',
  tenderloin_block: '誕生日テンダーロインブロック予約',
  birthday_room: '個室予約(バースデー等)',
  group: '団体予約',
};

export type ReservationNotifyInput = {
  reservationType: string;
  customerName: string;
  phone: string | null;
  partySize: number | null;
  reservationDate: string;
  reservationTime: string | null;
  notes: string | null;
  createdByName: string;
};

export async function notifyReservationCreated(r: ReservationNotifyInput): Promise<void> {
  const token = process.env.TELEGRAM_RESERVATION_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_RESERVATION_CHAT_ID;
  if (!token || !chatId) return;

  const lines = [
    '📅 新しい予約が入りました',
    `種別: ${TYPE_LABEL[r.reservationType] ?? r.reservationType}`,
    `お客様名: ${r.customerName} 様`,
    r.partySize != null ? `人数: ${r.partySize}名` : null,
    `日時: ${r.reservationDate}${r.reservationTime ? ` ${r.reservationTime}` : ''}`,
    r.phone ? `電話: ${r.phone}` : null,
    r.notes ? `備考: ${r.notes}` : null,
    `受付: ${r.createdByName}`,
  ].filter((line): line is string => line !== null);

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: lines.join('\n') }),
    });
  } catch {
    // 通知失敗は予約自体の成功を妨げない (Vercelのランタイムログには残る)。
  }
}
