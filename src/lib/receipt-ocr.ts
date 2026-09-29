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

/** マスタ名の末尾についている「注記」(括弧書き) を取り除く。マスタの仕入れ先名は
 * 「E-BAKERY (パン屋)」のように日本語の補足メモが付いていることが多いが、レシート本文
 * (英語・クメール語) にはこの注記は印字されないため、そのままでは毎回「未登録」と誤判定
 * されてしまう (2026-09-28 追加。Tom「登録名に日本語が入っているから新しい登録と勘違い
 * している。英語の完全一致でお願いしたい」への対応)。
 *
 * 当初は日本語の文字種 (ひらがな・カタカナ・漢字) だけを取り除いていたが、
 * 「CHHAT KANTHEA 018208464 (Staff)」のように注記が英語の場合はこの方法では取り除けず、
 * 依然としてマッチしない仕入れ先が多数残っていた (2026-09-29 発見)。注記は言語を問わず
 * 「名前の末尾の括弧書き」という位置で判別できるため、末尾の括弧を (全角/半角どちらも、
 * 複数連続していても) まるごと取り除く方式に変更した。
 * 例: 「Smart Mobile (PIN-less) 010308894 (携帯代)」→ 末尾の「(携帯代)」だけを除去し、
 * 実際の名前の一部である中間の「(PIN-less)」は残す。 */
function stripTrailingNote(s: string): string {
  let result = s;
  for (;;) {
    const stripped = result.replace(/[\s　]*[(（][^()（）]*[)）]\s*$/, '').trim();
    if (stripped === result) return result;
    result = stripped;
  }
}

/** OCRテキストの中に、既存マスタ (仕入れ先・費目) の名前がそのまま含まれているか探す。
 * 一番長く一致した候補を採用する (短い名前の偶然一致を避けるため)。マスタ名の末尾に
 * 注記 (括弧書き、日本語・英語問わず) が付いている場合は、その部分を除いた本体部分だけで
 * 照合する (注記を除くと短すぎる/空になる場合は元の名前のまま照合する)。 */
export function findBestMatch<T extends { name: string }>(text: string, candidates: T[]): T | null {
  const normText = normalize(text);
  let best: T | null = null;
  let bestLen = 0;
  for (const c of candidates) {
    const withoutNote = stripTrailingNote(c.name);
    const name = normalize(withoutNote.length >= 2 ? withoutNote : c.name);
    if (name.length >= 2 && normText.includes(name) && name.length > bestLen) {
      best = c;
      bestLen = name.length;
    }
  }
  return best;
}

// ---------- 支払先の文字列→費目の対応ヒント (2026-09-29 追加) ----------
// Tomが日頃使っているExcel台帳「支払先→内容候補」シートに基づく、送金確認画面等に印字される
// 送金元/受取人名の一部と費目の対応表。以前は費目マスタの名前をそのままOCR本文と文字列一致
// させていたが、費目「Mobile Joint (小口資金)」が送金元口座名「Mobile Joint Savings」に
// 偶然一致してしまう事故が起きたため廃止した (route.ts参照)。ここのキーはTom自身が
// 「レシートに実際に印字される文字列」として1件ずつ確認・登録したものなので、部分一致で
// 使っても安全 (無関係な一致が起きないよう銀行口座番号付きで登録されているものも多い)。
// 「HORY LINA」のように費目が変わりやすい支払先はExcel側でも候補なし (手動確認) として
// 空欄になっているため、ここでも対象外にしている。
const VENDOR_CATEGORY_HINTS: { match: string; category: string }[] = [
  { match: 'VISA Merchant Deposit', category: 'payment processing Fee (支払い手数料)' },
  { match: 'MasterCard Merchant Deposit', category: 'payment processing Fee (支払い手数料)' },
  { match: 'JCB Merchant Deposit', category: 'payment processing Fee (支払い手数料)' },
  { match: 'TENG CHEK 007786167', category: 'Personnel expenses (人件費)' },
  { match: 'SANG REAKSA 004848042', category: 'Personnel expenses (人件費)' },
  { match: 'CHHAT KANTHEA 018208464', category: 'Personnel expenses (人件費)' },
  { match: 'SEM PISETH 008979712', category: 'Personnel expenses (人件費)' },
  { match: 'THAM THAMEAN 000348424', category: 'Personnel expenses (人件費)' },
  {
    match: 'MATSUZAKI TSUYOSHI AND MATSUZAKI YUKA AND THAM THAMEAN AND SANG REAKSA AND GOTO YASUHIKO 014790368',
    category: 'Petty Cash (小口現金用)',
  },
  { match: 'SEANG CHANTHA 002048257', category: 'Rent ond others (賃料他)' },
  { match: 'Electricite du Cambodge - EDC 5655410', category: 'Utility (光熱費)' },
  { match: 'Electricite du Cambodge', category: 'Utility (光熱費)' },
  { match: 'PP WATER SUPPLY', category: 'Utility (光熱費)' },
  { match: 'BROWN', category: 'Business Meeting Expenses (業務上の会議費)' },
  { match: 'SAKURA BOEUNG TRABEK', category: 'cooking supplies (調理用品)' },
  { match: 'HOR NAIKUOY', category: 'Supplies expense (消耗品費)' },
  { match: 'HOEU SREYLEAKHOEU SREYLEAK 500035185', category: 'ingredients (材料仕入れ)' },
  { match: 'HOEU SREYLEAK 015373709', category: 'ingredients (材料仕入れ)' },
  { match: 'HOEU SREYLEAK', category: 'ingredients (材料仕入れ)' },
  { match: 'ANGKOR MART', category: 'ingredients (材料仕入れ)' },
  { match: 'ANGKOR MARKET', category: 'ingredients (材料仕入れ)' },
  { match: 'Lucky Toul Tom Poung', category: 'ingredients (材料仕入れ)' },
  { match: 'DFI LUCKY TOUL TUMPONG 2', category: 'ingredients (材料仕入れ)' },
  { match: 'LY CHHAY', category: 'ingredients (材料仕入れ)' },
  { match: 'CMRT 371 SUPERMARKET', category: 'ingredients (材料仕入れ)' },
  { match: 'E-BAKERY', category: 'ingredients (材料仕入れ)' },
  { match: 'MORN NITH', category: 'ingredients (材料仕入れ)' },
  { match: 'PROEM PHEAROM', category: 'ice (氷代)' },
  { match: 'TRY KIMCHHAY', category: 'ingredients (材料仕入れ)' },
  { match: 'For You Copy by R.SO', category: 'print (印刷代)' },
  { match: 'YOUHOUR by K.SIM', category: 'Liqual drinks (酒代)' },
  { match: 'MAO SREYPINE', category: 'Liqual drinks (酒代)' },
  { match: 'Smart Mobile (PIN-less) 010308894', category: 'Communication Expenses (通信費)' },
];

/** レシート本文がTom curated の支払先ヒントに一致するか調べ、対応する費目名を返す。
 * 一番長く一致したものを採用する (findBestMatchと同じ考え方)。 */
export function findCategoryHint(text: string): string | null {
  const normText = normalize(text);
  let best: string | null = null;
  let bestLen = 0;
  for (const hint of VENDOR_CATEGORY_HINTS) {
    const key = normalize(hint.match);
    if (key.length >= 3 && normText.includes(key) && key.length > bestLen) {
      best = hint.category;
      bestLen = key.length;
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

/** 「金額行の次の行」(ABA送金確認画面などの受取人名パターン) だけから店名候補を取り出す。
 * 複数の金額行候補それぞれで順番に試し、最初に「店名として妥当」と判定できたものを採用する
 * (例: 通知トーストの次の行が「口座から支払いました」のようなKhmerの案内文だった場合は
 * スキップし、本体カードの次の行にある実際の店名を採用する)。USD建てのヘッダーを優先し、
 * 無ければKHR建てのヘッダーも試す。
 *
 * この関数が候補を返せた場合、それは「受取人名」という位置的に確実な情報なので、呼び出し側
 * (receipt-scan.ts) ではこちらをOCR全文からの単純部分一致 (findBestMatch/findCategoryHint)
 * より優先して使う (2026-09-29 発見・修正。Tomの実例: 送金元の口座名義
 * 「MATSUZAKI TSUYOSHI AND MATSUZAKI YUKA AND...」(送金元の家族共同口座) が、たまたま
 * マスタ登録済みの仕入れ先「MATSUZAKI TSUYOSHI」(小口現金入金用に登録していたもの) と
 * 部分一致してしまい、実際の受取人「LOU MUYNGOR」ではなくそちらが選ばれてしまうバグが
 * 発生したため。送金元の口座名義は本文中のどこか別の場所に出てくることがあっても、
 * 店名の候補としては絶対に採用してはいけない)。 */
export function guessSellerFromAmountHeader(text: string): string | null {
  const lines = text.split('\n').map((l) => l.trim());
  const headers = [...findAmountHeaderLines(lines), ...findKhrHeaderLines(lines)];
  for (const header of headers) {
    const candidate = lines[header.lineIndex + 1]?.trim();
    if (candidate && candidate.length >= 2 && !looksLikeNonVendorLine(candidate)) {
      return candidate;
    }
  }
  return null;
}

/** 既存マスタに一致しなかった場合の「店名っぽい行」の推測 (新規仕入れ先の登録提案用)。
 * まず guessSellerFromAmountHeader (送金確認画面の受取人名パターン) を試す。それでも
 * 見つからなければレシート先頭付近の意味のありそうな行を採用する (数字・記号だけの行、
 * 金額・電話番号らしき行は除外)。あくまで簡易的な推測 — ユーザーが確認・修正できる前提
 * (仕入れ先は元々自由入力欄のため、間違っていてもその場で書き換えられる)。 */
export function guessVendorNameFromText(text: string): string | null {
  const headerCandidate = guessSellerFromAmountHeader(text);
  if (headerCandidate) return headerCandidate;

  const lines = text.split('\n').map((l) => l.trim());
  const fallback = lines
    .filter((l) => l.length >= 2 && !/^[\d\s\-#:/.]+$/.test(l))
    .filter((l) => !looksLikeNonVendorLine(l));
  if (fallback.length === 0) return null;

  // 先頭候補が、後に出てくるより長い行の「先頭部分の一致」であれば、より完全な方を採用する
  // (2026-09-28 追加。通知トーストが画面の端で店名を途中までしか表示しておらず、OCRが
  // 「E-BA」のように店名を途中で切って読んでしまうことがある。同じ画面の下の方に完全な
  // 店名「E-BAKERY」が別途印字されているケースが多いため)。
  let best = fallback[0];
  for (const candidate of fallback.slice(1)) {
    if (candidate.length > best.length && candidate.toLowerCase().startsWith(best.toLowerCase())) {
      best = candidate;
    }
  }
  return best;
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
