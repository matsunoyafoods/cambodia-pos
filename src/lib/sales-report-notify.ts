import 'server-only';
import type { EthnicityKey } from '@/lib/pos-types';
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
//
// 表示言語 (2026-10-02 追加。Tom「テレグラムに送るレポート、言語を2個選べるようにして。
// 英語、日本語、クメール語」への対応)。matsunoya-dine側の expense-ocr-bridge.ts にある
// TELEGRAM_EXPENSE_GROUP_LANG の仕組みをそのまま踏襲する: TELEGRAM_SALES_REPORT_LANG env var
// にカンマ区切りで指定 (例: "ja,en")。未設定なら従来通り 'ja' のみ。複数指定した場合は
// 1通のメッセージの中に各言語のブロックを「┄┄┄」区切りで併記する (個人ごとの言語設定では
// なく、グループ全体で共通の設定。経費OCRのメッセージと見た目の体裁を合わせている)。
// 時間帯名 (ランチ・ディナー等。設定画面でTomが自由入力した文字列) と決済方法名
// (pos.payment_methods。店舗ごとの自由文字列) は翻訳データが無いため、どの言語ブロックでも
// 原文のまま表示する。

export type SalesReportLang = 'ja' | 'en' | 'km';
const ALL_LANGS: SalesReportLang[] = ['ja', 'en', 'km'];

function getSalesReportLangs(): SalesReportLang[] {
  const raw = process.env.TELEGRAM_SALES_REPORT_LANG;
  if (!raw) return ['ja'];
  const parsed = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is SalesReportLang => (ALL_LANGS as string[]).includes(s));
  return parsed.length > 0 ? parsed : ['ja'];
}

// 人種内訳の表示名。pos-types.ts の ETHNICITY_LABELS は日本語固定のため、ここでは
// EthnicityTotal.key (安定したenum値) から言語ごとのラベルを引き直す。
const ETHNICITY_LABELS: Record<SalesReportLang, Record<EthnicityKey, string>> = {
  ja: { khmer: 'クメール', japanese: '日本人', chinese: '中国人', korean: '韓国人', western: '西洋人', mix: 'MIXグループ', other: 'その他' },
  en: { khmer: 'Khmer', japanese: 'Japanese', chinese: 'Chinese', korean: 'Korean', western: 'Western', mix: 'Mixed group', other: 'Other' },
  km: { khmer: 'ខ្មែរ', japanese: 'ជប៉ុន', chinese: 'ចិន', korean: 'កូរ៉េ', western: 'លោកខាងលិច', mix: 'ក្រុមចម្រុះ', other: 'ផ្សេងទៀត' },
};

type SalesReportMessages = {
  title: (date: string) => string;
  salesTotal: string;
  guestsAndParties: (guestCount: number, partyCount: number) => string;
  ethnicityBreakdown: string;
  notRecorded: string;
  cashCounted: string;
  registerFloat: string;
  differenceExact: string;
  differenceLabel: string;
  differenceOverWord: string;
  differenceShortWord: string;
  confirmedBy: string;
};

const MESSAGES: Record<SalesReportLang, SalesReportMessages> = {
  ja: {
    title: (date) => `📊 レジ締め完了 (${date})`,
    salesTotal: '売上合計',
    guestsAndParties: (guestCount, partyCount) => `客数: ${guestCount}名 (組数: ${partyCount}組)`,
    ethnicityBreakdown: '人種内訳',
    notRecorded: '未記録',
    cashCounted: '現金カウント',
    registerFloat: 'レジ金',
    differenceExact: '差額: ちょうど',
    differenceLabel: '差額',
    differenceOverWord: '過剰',
    differenceShortWord: '不足',
    confirmedBy: '確認',
  },
  en: {
    title: (date) => `📊 Register closed (${date})`,
    salesTotal: 'Total sales',
    guestsAndParties: (guestCount, partyCount) => `Guests: ${guestCount} (Parties: ${partyCount})`,
    ethnicityBreakdown: 'Nationality breakdown',
    notRecorded: 'Not recorded',
    cashCounted: 'Cash counted',
    registerFloat: 'Register float',
    differenceExact: 'Difference: exact',
    differenceLabel: 'Difference',
    differenceOverWord: 'over',
    differenceShortWord: 'short',
    confirmedBy: 'Confirmed by',
  },
  km: {
    title: (date) => `📊 បិទគណនីរួចរាល់ (${date})`,
    salesTotal: 'ការលក់សរុប',
    guestsAndParties: (guestCount, partyCount) => `ចំនួនភ្ញៀវ: ${guestCount}នាក់ (ចំនួនក្រុម: ${partyCount}ក្រុម)`,
    ethnicityBreakdown: 'ប្រភេទជនជាតិ',
    notRecorded: 'មិនទាន់កត់ត្រា',
    cashCounted: 'ប្រាក់សុទ្ធដែលបានរាប់',
    registerFloat: 'ប្រាក់អាវចាប់ផ្តើម',
    differenceExact: 'ភាពខុសគ្នា: ត្រឹមត្រូវ',
    differenceLabel: 'ភាពខុសគ្នា',
    differenceOverWord: 'លើស',
    differenceShortWord: 'ខ្វះ',
    confirmedBy: 'បានបញ្ជាក់ដោយ',
  },
};

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

function formatDifferenceLine(lang: SalesReportLang, differenceUsd: number): string {
  const m = MESSAGES[lang];
  if (Math.abs(differenceUsd) < 0.005) return m.differenceExact;
  const sign = differenceUsd > 0 ? '+' : '';
  const word = differenceUsd > 0 ? m.differenceOverWord : m.differenceShortWord;
  return `${m.differenceLabel}: ${sign}$${differenceUsd.toFixed(2)} (${word})`;
}

function formatEthnicityLine(lang: SalesReportLang, totals: EthnicityTotal[]): string {
  const m = MESSAGES[lang];
  if (totals.length === 0) return m.notRecorded;
  return totals.map((e) => `${ETHNICITY_LABELS[lang][e.key]}${e.count}`).join(' / ');
}

// 複数言語のブロックを経費OCRメッセージと同じ区切り線で併記する。
function joinBlocks(blocks: string[]): string {
  return blocks.join('\n\n┄┄┄┄┄\n\n');
}

function buildBlock(lang: SalesReportLang, input: RegisterClosingNotifyInput): string {
  const m = MESSAGES[lang];
  const methodLines = Object.entries(input.systemTotalsByMethod).map(([method, amount]) => `・${method}: $${amount.toFixed(2)}`);
  const timePeriodLines = input.timePeriodSales.map((p) => `・${p.label} (${p.start}-${p.end}): $${p.total.toFixed(2)}`);

  const lines = [
    m.title(input.date),
    '',
    `${m.salesTotal}: $${input.salesTotal.toFixed(2)}`,
    ...methodLines,
    '',
    m.guestsAndParties(input.guestCount, input.partyCount),
    `${m.ethnicityBreakdown}: ${formatEthnicityLine(lang, input.ethnicityTotals)}`,
    timePeriodLines.length > 0 ? '' : null,
    ...timePeriodLines,
    '',
    `${m.cashCounted}: $${input.countedTotalUsd.toFixed(2)}`,
    input.registerFloatUsd ? `${m.registerFloat}: $${input.registerFloatUsd.toFixed(2)}` : null,
    formatDifferenceLine(lang, input.differenceUsd),
    input.confirmedByName ? '' : null,
    input.confirmedByName ? `${m.confirmedBy}: ${input.confirmedByName}` : null,
  ].filter((line): line is string => line !== null);

  return lines.join('\n');
}

export async function notifyRegisterClosing(input: RegisterClosingNotifyInput): Promise<void> {
  const baseUrl = (process.env.NEXT_PUBLIC_MATSUNOYA_DINE_API_URL ?? 'https://app.matsunoyafoods.com').replace(/\/$/, '');
  const secret = process.env.TELEGRAM_BRIDGE_SECRET;
  if (!secret) return; // 未設定の間は何もしない (予約通知と同じ方針。設定漏れをエラーにしない)

  const langs = getSalesReportLangs();
  const text = joinBlocks(langs.map((lang) => buildBlock(lang, input)));

  try {
    await fetch(`${baseUrl}/api/bridge/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bridge-secret': secret },
      // target: 'sales_report' 専用のTelegramグループ (経費OCRのOrderingグループとは別。
      // Tom「ここの選択をミスしました。売上レポートは chat_id: -4890320771 に送りたい」)
      body: JSON.stringify({ text, target: 'sales_report' }),
    });
  } catch {
    // 通知失敗はレジ締め自体の成功を妨げない (Vercelのランタイムログには残る想定は
    // 呼び出し側の .catch(() => {}) 側で行う)
  }
}
