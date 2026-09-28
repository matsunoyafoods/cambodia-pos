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
