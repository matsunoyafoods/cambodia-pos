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

/** 既存マスタに一致しなかった場合の「店名っぽい行」の推測 (新規仕入れ先の登録提案用)。
 * レシートは通常、先頭付近に店名が印字されるため、意味のありそうな最初の行を採用する
 * (数字・記号だけの行は除外)。あくまで簡易的な推測 — ユーザーが確認・修正できる前提
 * (仕入れ先は元々自由入力欄のため、間違っていてもその場で書き換えられる)。 */
export function guessVendorNameFromText(text: string): string | null {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length >= 2 && !/^[\d\s\-#:/.]+$/.test(l));
  return lines[0] ?? null;
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
 * なしの場合は必ず小数点以下2桁を要求する。 */
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

/** レシート全文から合計金額 (USD) を推測する。「合計」「TOTAL」等のキーワード行 (無ければ
 * 次の行も見る) を優先し、見つからなければ本文中で一番大きい金額らしき数値を採用する
 * (グランドトータルは通常、個々の商品単価より大きいため)。 */
export function guessAmountFromText(text: string): number | null {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  let bestFromKeyword: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    if (AMOUNT_KEYWORDS.some((kw) => lower.includes(kw))) {
      const amt = extractLargestAmount(lines[i]) ?? extractLargestAmount(lines[i + 1] ?? '');
      if (amt !== null && (bestFromKeyword === null || amt > bestFromKeyword)) {
        bestFromKeyword = amt;
      }
    }
  }
  if (bestFromKeyword !== null) return bestFromKeyword;

  return extractLargestAmount(text);
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
