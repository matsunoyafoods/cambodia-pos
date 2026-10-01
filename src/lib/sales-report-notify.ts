import 'server-only';
import type { EthnicityTotal, TimePeriodSalesResult } from '@/lib/sales-aggregation';

// レジ締め確定時にその日の売上内容をTelegramへ通知する (2026-09-30 追加)。
// Tom「売上レポートがテレグラムグループに届きません」→ 調査した結果、そもそも
// 「レジ締め確定→Telegram通知」という機能自体がまだ無かったため、新規に作った。
// 送信先は経費OCRと同じOrderingグループにする予定だったが、Tomから訂正があり
// 専用の別グループ (chat_id: -4890320771、matsunoya-dine側の env var
// TELEGRAM_SALES_REPORT_CHAT_ID) に送る。
//
// 送信先は matsunoya-dine 側の /api/bridge/notify (新設)。cambodia-pos は自前のTelegram Bot
// 送信をここでは行わない — 経費OCR確認カードを送っているのと同じBotを使う (グループは別) ため、
// 既存の telegram-expense-ocr ブリッジと対になる仕組み (共有シークレット
// TELEGRAM_BRIDGE_SECRET は両プロジェクトに既に設定済み) をそのまま使う。
//
// 通知の成否でレジ締め自体を失敗させないよう、呼び出し側では await せず
// `.catch(() => {})` で fire-and-forget する想定 (この関数自体も内部で例外を握りつぶす)。

export type RegisterClosingNotifyInput = {
  date: string;
  salesTotal: number;
  systemTotalsByMethod: Record<string, number>;
  countedTotalUsd: number;
  differenceUsd: number;
  registerFloatUsd: number;
  confirmedByName: string | null;
  // 客数・組数・人種内訳・時間帯別売上 (2026-10-01 追加)。Tom「客数、組数、人種人数、
  // ランチタイム売上、ディナータイム売上をレポートに追記してほしい」への対応。
  guestCount: number;
  partyCount: number;
  ethnicityTotals: EthnicityTotal[];
  timePeriodSales: TimePeriodSalesResult[];
};

function formatDifferenceLine(differenceUsd: number): string {
  if (Math.abs(differenceUsd) < 0.005) return '差額: ちょうど';
  const sign = differenceUsd > 0 ? '+' : '';
  const label = differenceUsd > 0 ? '過剰' : '不足';
  return `差額: ${sign}$${differenceUsd.toFixed(2)} (${label})`;
}

export async function notifyRegisterClosing(input: RegisterClosingNotifyInput): Promise<void> {
  const baseUrl = (process.env.NEXT_PUBLIC_MATSUNOYA_DINE_API_URL ?? 'https://app.matsunoyafoods.com').replace(/\/$/, '');
  const secret = process.env.TELEGRAM_BRIDGE_SECRET;
  if (!secret) return; // 未設定の間は何もしない (予約通知と同じ方針。設定漏れをエラーにしない)

  const methodLines = Object.entries(input.systemTotalsByMethod).map(
    ([method, amount]) => `・${method}: $${amount.toFixed(2)}`,
  );

  const ethnicityLine =
    input.ethnicityTotals.length > 0 ? input.ethnicityTotals.map((e) => `${e.label}${e.count}`).join(' / ') : '未記録';

  const timePeriodLines = input.timePeriodSales.map((p) => `・${p.label} (${p.start}-${p.end}): $${p.total.toFixed(2)}`);

  const lines = [
    `📊 レジ締め完了 (${input.date})`,
    '',
    `売上合計: $${input.salesTotal.toFixed(2)}`,
    ...methodLines,
    '',
    `客数: ${input.guestCount}名 (組数: ${input.partyCount}組)`,
    `人種内訳: ${ethnicityLine}`,
    timePeriodLines.length > 0 ? '' : null,
    ...timePeriodLines,
    '',
    `現金カウント: $${input.countedTotalUsd.toFixed(2)}`,
    input.registerFloatUsd ? `レジ金: $${input.registerFloatUsd.toFixed(2)}` : null,
    formatDifferenceLine(input.differenceUsd),
    input.confirmedByName ? '' : null,
    input.confirmedByName ? `確認: ${input.confirmedByName}` : null,
  ].filter((line): line is string => line !== null);

  try {
    await fetch(`${baseUrl}/api/bridge/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bridge-secret': secret },
      // target: 'sales_report' 専用のTelegramグループ (経費OCRのOrderingグループとは別。
      // Tom「ここの選択をミスしました。売上レポートは chat_id: -4890320771 に送りたい」)
      body: JSON.stringify({ text: lines.join('\n'), target: 'sales_report' }),
    });
  } catch {
    // 通知失敗はレジ締め自体の成功を妨げない (Vercelのランタイムログには残る想定は
    // 呼び出し側の .catch(() => {}) 側で行う)
  }
}
