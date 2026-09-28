import 'server-only';

// レシートOCR (2026-09-28 追加。Tom「レシートを読み込んで、既存設定の科目と受領名を自動で
// 選択されるようにしたい」への対応)。Google Cloud Vision API (Text Detection) をREST経由で
// 呼び出す。サービスアカウントのJSON鍵ではなく、Vision APIキー1本で済む方式にした
// (Vercelの環境変数 GOOGLE_CLOUD_VISION_API_KEY に設定してもらう。Google Cloud側の準備
// [プロジェクト作成・Vision API有効化・請求先アカウント登録(無料枠内でもカード登録は必須)・
// APIキー発行] はTom自身に行ってもらう必要がある — アカウント作成・課金登録は代行できないため)。
// 料金: 月1,000件までは無料、以降は1,000件あたり$1.50 (2026-09時点、Google公式サイトで確認)。

export class ReceiptOcrError extends Error {}

/** レシート画像 (base64、data URLのprefixなし) からテキストを抽出する。 */
export async function extractReceiptText(imageBase64: string): Promise<string> {
  const apiKey = process.env.GOOGLE_CLOUD_VISION_API_KEY;
  if (!apiKey) {
    throw new ReceiptOcrError('ocr_not_configured');
  }

  const res = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [
        {
          image: { content: imageBase64 },
          features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
          // レシートは日本語・英語・クメール語が混在しうるため言語ヒントを渡す
          imageContext: { languageHints: ['ja', 'en', 'km'] },
        },
      ],
    }),
  });

  if (!res.ok) {
    throw new ReceiptOcrError(`vision_api_error_${res.status}`);
  }
  const json = (await res.json()) as {
    responses?: { fullTextAnnotation?: { text?: string }; error?: { message?: string } }[];
  };
  const result = json.responses?.[0];
  if (result?.error) {
    throw new ReceiptOcrError(result.error.message ?? 'vision_api_error');
  }
  return result?.fullTextAnnotation?.text ?? '';
}

// ---------- 文字列マッチング (既存マスタ一覧との照合) ----------

function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s　]+/g, '').trim();
}

/** OCRテキストの中に、既存マスタ (仕入れ先・費目) の名前がそのまま含まれているか探す。
 * 一番長く一致した候補を採用する (短い名前の偶然一致を避けるため)。 */
export function findBestMatch<T extends { name: string }>(text: string, candidates: T[]): T | null {
  const normText = normalize(text);
  let best: T | null = null;
  let bestLen = 0;
  for (const c of candidates) {
    const name = normalize(c.name);
    if (name.length >= 2 && normText.includes(name) && name.length > bestLen) {
      best = c;
      bestLen = name.length;
    }
  }
  return best;
}

// ---------- ABA銀行アプリ等の送金確認画面向けの調整 (2026-09-28 追加) ----------
// Tomの利用は「紙のレシートより銀行アプリの送金確認画面がメイン」とのことなので、その画面
// レイアウトに合わせて精度を上げる。共通パターン: 金額だけの行 (例 "-2.95 USD") の次の行に
// 店名 (受取人名) が来る。このパターンをまず優先的に探し、見つからない場合のみ従来の
// 汎用ヒューリスティックにフォールバックする。
//
// 重要: 送金確認画面には「Original amount: 14,500.00 KHR」のようにリエル建ての金額も
// 印字されることがある (USDへの自動換算前の元金額)。数値としてはUSD建ての金額より大幅に
// 大きくなるため、「本文中で一番大きい数値」のような単純な推測だと誤って採用してしまう。
// そのため KHR/៛ が含まれる行は金額候補から常に除外する。

function lineHasRielMarker(s: string): boolean {
  return /KHR|៛/i.test(s);
}

/** 金額・電話番号・取引番号など「店名ではなさそうな」行かどうかを判定する。
 * (2026-09-28 追加。銀行アプリの送金確認画面をスキャンした際、ポップアップ通知と重なって
 * OCRが「E」(店名の一部) と「2.95 USD」(金額) を1行に混ぜてしまい、"E-2.95 USD" という
 * 店名候補を返してしまう事例があったための対策。「Original amount:」「Purchase #:」等の
 * ラベル行 (末尾がコロン) や、電話番号・口座番号・取引番号の断片 (3桁以上の連続する数字)
 * も除外する。) */
function looksLikeNonVendorLine(s: string): boolean {
  if (/(?:USD|US\$|\$|KHR|៛)/i.test(s)) return true;
  if (/\b[0-9]{1,6}(?:,[0-9]{3})*\.[0-9]{2}\b/.test(s)) return true;
  if (/\d{3,}/.test(s)) return true;
  if (/[:：]\s*$/.test(s)) return true;
  const digitCount = (s.match(/[0-9]/g) ?? []).length;
  if (digitCount >= s.length * 0.4) return true;
  return false;
}

/** 「-2.95 USD」のように、金額とUSD表記だけで構成された行 (前後に他の文字が無いもの) を
 * 全て探す。ABA等の送金確認画面のヘッダー部分にほぼ必ず現れる形式。通知トーストのプレビュー
 * や「Original amount: 69.31 USD」のようにラベルと値が別行になったケースなど、同じ画面に
 * 複数回現れることがあるため、行番号付きで全件返す (呼び出し側で「次の行が店名として妥当な
 * 最初の一致」を選ぶ)。 */
function findAmountHeaderLines(lines: string[]): { amount: number; lineIndex: number }[] {
  const re = /^-?\$?\s*([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2})\s*USD\.?$/i;
  const matches: { amount: number; lineIndex: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(re);
    if (m) {
      const num = Number(m[1].replace(/,/g, ''));
      if (Number.isFinite(num) && num > 0) matches.push({ amount: num, lineIndex: i });
    }
  }
  return matches;
}

/** 「-14,500 KHR」のように、リエル建ての金額単独行を全て探す (findAmountHeaderLinesの
 * KHR版)。USD建てのヘッダーが無い純粋なリエル建てのレシート・送金画面でも、店名候補は
 * 「金額行の次の行」から拾えるようにするため。 */
function findKhrHeaderLines(lines: string[]): { amount: number; lineIndex: number }[] {
  const re = /^-?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)\s*(?:KHR|៛)\.?$/i;
  const matches: { amount: number; lineIndex: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(re);
    if (m) {
      const num = Number(m[1].replace(/,/g, ''));
      if (Number.isFinite(num) && num > 0) matches.push({ amount: num, lineIndex: i });
    }
  }
  return matches;
}

/** 既存マスタに一致しなかった場合の「店名っぽい行」の推測 (新規仕入れ先の登録提案用)。
 * まず「金額行の次の行」(送金確認画面の受取人名パターン) を、複数の金額行候補それぞれで
 * 順番に試し、最初に「店名として妥当」と判定できたものを採用する (例: 通知トーストの次の
 * 行が「口座から支払いました」のようなKhmerの案内文だった場合はスキップし、本体カードの
 * 次の行にある実際の店名を採用する)。USD建てのヘッダーを優先し、無ければKHR建てのヘッダー
 * も試す。どれも妥当でなければレシート先頭付近の意味のありそうな行を採用する (数字・記号
 * だけの行、金額・電話番号らしき行は除外)。あくまで簡易的な推測 — ユーザーが確認・修正
 * できる前提 (仕入れ先は元々自由入力欄のため、間違っていてもその場で書き換えられる)。 */
export function guessVendorNameFromText(text: string): string | null {
  const lines = text.split('\n').map((l) => l.trim());

  const headers = [...findAmountHeaderLines(lines), ...findKhrHeaderLines(lines)];
  for (const header of headers) {
    const candidate = lines[header.lineIndex + 1]?.trim();
    if (candidate && candidate.length >= 2 && !looksLikeNonVendorLine(candidate)) {
      return candidate;
    }
  }

  const fallback = lines
    .filter((l) => l.length >= 2 && !/^[\d\s\-#:/.]+$/.test(l))
    .filter((l) => !looksLikeNonVendorLine(l));
  return fallback[0] ?? null;
}

// ---------- 金額・日付の推測 (2026-09-28 追加) ----------
// Tom「金額と日付も自動入力してほしい」への対応。レシート本文から正規表現で抽出する
// best-effort な推測 — 必ず手入力欄で確認・修正できる前提 (誤読時も入力自体は止めない)。
// 通貨は amountUsd 前提 (このアプリはUSD建てのみ)。KHR (リエル) 表記の金額は対象外。

const AMOUNT_KEYWORDS = [
  'grand total',
  'amount due',
  'total due',
  'net total',
  'sub total',
  'subtotal',
  'total',
  'amount',
  'sum',
  '合計',
  '小計',
  '請求',
  '金額',
  'សរុប',
];

/** 1行 (または任意の文字列) の中から、通貨記号付き・または小数点2桁付きの金額のうち
 * 最大のものを取り出す。レシート番号や電話番号などの整数の誤検出を避けるため、通貨記号
 * なしの場合は必ず小数点以下2桁を要求する。KHR/៛ を含む行は呼び出し側で除外してから渡す
 * こと (元のリエル建て金額をUSDと誤認しないため)。 */
function extractLargestAmount(s: string): number | null {
  const re = /(?:USD|US\$|\$)\s*([0-9]{1,6}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)|\b([0-9]{1,6}(?:,[0-9]{3})*\.[0-9]{2})\b/g;
  let best: number | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const raw = m[1] ?? m[2];
    if (!raw) continue;
    const num = Number(raw.replace(/,/g, ''));
    if (!Number.isFinite(num) || num <= 0) continue;
    if (best === null || num > best) best = num;
  }
  return best;
}

/** レシート全文から合計金額 (USD) を推測する。
 * 1. まず「-2.95 USD」のような金額単独行 (送金確認画面のヘッダー) を探す — 見つかれば最優先。
 * 2. 無ければ「合計」「TOTAL」等のキーワード行 (無ければ次の行も見る) を採用する。
 * 3. それでも無ければ本文中で一番大きい金額らしき数値を採用する。
 * いずれの段階でも KHR/៛ を含む行は候補から除外する (リエル建ての「Original amount」等を
 * USD建てと誤認しないため)。 */
/** 本文中の「14,500.00 KHR」のようなリエル建て金額を探す (一番大きい値を採用。複数の
 * 商品単価とグランドトータルが両方リエルで印字されている場合、合計が一番大きい値になる
 * ことが多いため)。USD建ての金額が最後まで見つからなかった場合のみ、店舗の参考為替レート
 * (設定 → 一般設定 → 参考為替レート、khrRate) でドル換算するために使う。 */
function extractKhrAmount(text: string): number | null {
  const re = /([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)\s*(?:KHR|៛)|(?:KHR|៛)\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)/gi;
  let best: number | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[1] ?? m[2];
    if (!raw) continue;
    const num = Number(raw.replace(/,/g, ''));
    if (!Number.isFinite(num) || num <= 0) continue;
    if (best === null || num > best) best = num;
  }
  return best;
}

/** レシート全文から合計金額 (USD) を推測する。金額推測の優先順位は関数コメント参照。
 * USD建ての金額が最後まで見つからなかった場合、`khrRate` (店舗の参考為替レート、
 * 設定 → 一般設定) が渡されていればリエル建ての金額をドルに換算して返す (2026-09-28
 * 追加。Tom「リエルは設定した1ドル4000リエルで計算してドル変換して入力してください」
 * への対応。銀行側の実際の換算レートではなく、店舗で決めた一定レートを使うことで経費
 * 集計上の一貫性を優先する判断)。 */
export function guessAmountFromText(text: string, khrRate?: number): number | null {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  const headers = findAmountHeaderLines(lines);
  if (headers.length > 0) return headers[0].amount;

  const usdLines = lines.filter((l) => !lineHasRielMarker(l));

  let bestFromKeyword: number | null = null;
  for (let i = 0; i < usdLines.length; i++) {
    const lower = usdLines[i].toLowerCase();
    if (AMOUNT_KEYWORDS.some((kw) => lower.includes(kw))) {
      const amt = extractLargestAmount(usdLines[i]) ?? extractLargestAmount(usdLines[i + 1] ?? '');
      if (amt !== null && (bestFromKeyword === null || amt > bestFromKeyword)) {
        bestFromKeyword = amt;
      }
    }
  }
  if (bestFromKeyword !== null) return bestFromKeyword;

  const fallbackUsd = extractLargestAmount(usdLines.join('\n'));
  if (fallbackUsd !== null) return fallbackUsd;

  if (khrRate && khrRate > 0) {
    const khrAmount = extractKhrAmount(text);
    if (khrAmount !== null) {
      return Math.round((khrAmount / khrRate) * 100) / 100;
    }
  }

  return null;
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** year/month/day が実在する日付か検証し、レシートとして妥当な範囲 (今日の2年前〜翌日まで。
 * OCR誤読による極端な日付を除外するため) であれば 'YYYY-MM-DD' を返す。 */
function toIsoIfValid(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  const now = new Date();
  const twoYearsAgoMs = now.getTime() - 2 * 365 * 24 * 60 * 60 * 1000;
  const oneDayAheadMs = now.getTime() + 24 * 60 * 60 * 1000;
  if (d.getTime() < twoYearsAgoMs || d.getTime() > oneDayAheadMs) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** DD/MM/YYYY 系の数値3つを day/month に割り当てる (カンボジアの慣習に合わせ、両方とも
 * 12以下で曖昧な場合は DD/MM とみなす。どちらかが13以上ならその位置を日と確定できる)。 */
function assignDayMonth(a: number, b: number): { day: number; month: number } {
  if (a > 12 && b <= 12) return { day: a, month: b };
  if (b > 12 && a <= 12) return { day: b, month: a };
  return { day: a, month: b };
}

/** レシート全文から発行日を推測する。ISO形式 (YYYY-MM-DD) を最優先し、次に月名付き表記、
 * 最後に DD/MM/YYYY 系の数値表記を試す。 */
export function guessDateFromText(text: string): string | null {
  let m = text.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (m) {
    const iso = toIsoIfValid(Number(m[1]), Number(m[2]), Number(m[3]));
    if (iso) return iso;
  }

  m = text.match(/\b(\d{1,2})\s+([A-Za-z]{3,})\s*,?\s*(20\d{2})\b/);
  if (m) {
    const mon = MONTH_NAMES[m[2].slice(0, 3).toLowerCase()];
    if (mon) {
      const iso = toIsoIfValid(Number(m[3]), mon, Number(m[1]));
      if (iso) return iso;
    }
  }

  m = text.match(/\b([A-Za-z]{3,})\s+(\d{1,2}),?\s+(20\d{2})\b/);
  if (m) {
    const mon = MONTH_NAMES[m[1].slice(0, 3).toLowerCase()];
    if (mon) {
      const iso = toIsoIfValid(Number(m[3]), mon, Number(m[2]));
      if (iso) return iso;
    }
  }

  m = text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/);
  if (m) {
    const { day, month } = assignDayMonth(Number(m[1]), Number(m[2]));
    const iso = toIsoIfValid(Number(m[3]), month, day);
    if (iso) return iso;
  }

  m = text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2})\b/);
  if (m) {
    const { day, month } = assignDayMonth(Number(m[1]), Number(m[2]));
    const iso = toIsoIfValid(2000 + Number(m[3]), month, day);
    if (iso) return iso;
  }

  return null;
}
