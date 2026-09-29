import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import {
  extractReceiptText,
  findBestMatch,
  findCategoryHint,
  guessAmountFromText,
  guessDateFromText,
  guessSellerFromAmountHeader,
  guessVendorNameFromText,
  ReceiptOcrError,
} from '@/lib/receipt-ocr';
import type { ExpenseCategory, ExpenseVendor } from '@/lib/pos-types';

// レシート画像 (base64) を渡すと、OCR + マッチングまで一括で行う共通ロジック。
// 元々は scan-receipt/route.ts に直接書かれていたが、Telegram Bot 連携 (2026-09-29 追加。
// Tom「TelegramグループのABA送金確認画面をBotが読み取ってPOSに自動入力したい」への対応) で
// 同じロジックを認証方式の違う別エンドポイント (bridge/telegram-expense-ocr) からも使う必要が
// あったため、HTTPの認証・レスポンス整形部分を分離してこちらに切り出した。
// scan-receipt/route.ts (スタッフのブラウザセッション認証) と bridge 側 (Bot用の共有シークレット
// 認証) の両方がこの関数を呼ぶ。

export type ReceiptScanResult = {
  matchedVendor: { id: string; name: string } | null;
  vendorNameGuess: string | null;
  matchedCategory: { id: string; name: string } | null;
  amountGuess: number | null;
  dateGuess: string | null;
  /** OCR本文がそもそも支払い・レシートらしい内容かどうか (USD/KHR等の通貨表記や金額が
   * 見つかったか)。Telegram連携で、商品の写真等 (支払い画面ではないもの) を無視するために使う。
   * scan-receipt (カメラ撮影) 側では現状使っていないが、将来同じ判定を使いたくなった時のために
   * 一緒に返しておく。 */
  looksLikePaymentImage: boolean;
};

export async function runReceiptScan(imageBase64: string): Promise<{ text: string; result: ReceiptScanResult }> {
  const text = await extractReceiptText(imageBase64);
  // OCR抽出結果のログ (2026-09-28 追加、一時的な調査用。金額・日付の推測精度を上げるために
  // 実際のレシートでどんなテキストが返ってくるかを確認する目的。画像自体や個人情報は出力しない)
  console.log('[receipt-scan] ocr text (first 500 chars):', text.slice(0, 500));

  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const [{ data: vendorRows, error: vendorError }, { data: categoryRows, error: categoryError }, { data: storeRow }] = await Promise.all([
    supabase.from('expense_vendors').select('id, name, sort_order').eq('store_id', storeId),
    supabase.from('expense_categories').select('id, name, sort_order').eq('store_id', storeId),
    supabase.from('stores').select('settings').eq('id', storeId).maybeSingle(),
  ]);
  if (vendorError) throw new Error(vendorError.message);
  if (categoryError) throw new Error(categoryError.message);

  // リエル建てレシートのドル換算用 (2026-09-28 追加)。設定 → 一般設定 → 参考為替レート
  // (khrRate) と同じ値を使う。他のルート (register-closings 等) と同様、ここでも直接
  // settings JSON を読む (共有ヘルパーは無い、既存パターンを踏襲)。
  const storeSettings = storeRow?.settings as { khrRate?: number } | null;
  const khrRate = typeof storeSettings?.khrRate === 'number' ? storeSettings.khrRate : 4100;

  const vendors: ExpenseVendor[] = (vendorRows ?? []).map((r) => ({ id: r.id, name: r.name, sortOrder: r.sort_order }));
  const categories: ExpenseCategory[] = (categoryRows ?? []).map((r) => ({ id: r.id, name: r.name, sortOrder: r.sort_order }));

  // 「受取人名」(ABA送金確認画面などで金額行の直後に来る名前) が取れる場合は、それだけを
  // マスタ照合の対象にする。OCR全文 (findBestMatch(text, ...)) には送金元の口座名義
  // (From account / Sender) も含まれており、それがたまたま無関係なマスタ名と部分一致して
  // しまう事故が実際に起きたため (2026-09-29、Tomの実機テストで発覚。詳細は
  // guessSellerFromAmountHeader のコメント参照)。受取人名候補が無い場合のみ、従来通り
  // OCR全文でのマッチングにフォールバックする。
  const sellerCandidate = guessSellerFromAmountHeader(text);
  const matchedVendor = sellerCandidate ? findBestMatch(sellerCandidate, vendors) : findBestMatch(text, vendors);
  const vendorNameGuess = matchedVendor ? null : (sellerCandidate ?? guessVendorNameFromText(text));

  let matchedCategory: ExpenseCategory | null = null;
  if (matchedVendor) {
    const { data: pastRows, error: pastError } = await supabase
      .from('expenses')
      .select('category')
      .eq('store_id', storeId)
      .eq('vendor', matchedVendor.name)
      .order('created_at', { ascending: false })
      .limit(20);
    if (!pastError && pastRows && pastRows.length > 0) {
      const counts = new Map<string, number>();
      for (const row of pastRows) counts.set(row.category, (counts.get(row.category) ?? 0) + 1);
      let topCategory: string | null = null;
      let topCount = 0;
      for (const [cat, count] of counts) {
        if (count > topCount) {
          topCategory = cat;
          topCount = count;
        }
      }
      if (topCategory) {
        matchedCategory = categories.find((c) => c.name === topCategory) ?? { id: '', name: topCategory, sortOrder: -1 };
      }
    }
  }
  if (!matchedCategory) {
    const hintCategory = findCategoryHint(text);
    if (hintCategory) {
      matchedCategory = categories.find((c) => c.name === hintCategory) ?? { id: '', name: hintCategory, sortOrder: -1 };
    }
  }

  const amountGuess = guessAmountFromText(text, khrRate);
  const dateGuess = guessDateFromText(text);
  const looksLikePaymentImage = amountGuess !== null || /USD|KHR|៛|\$/i.test(text);

  const result: ReceiptScanResult = {
    matchedVendor: matchedVendor ? { id: matchedVendor.id, name: matchedVendor.name } : null,
    vendorNameGuess,
    matchedCategory: matchedCategory ? { id: matchedCategory.id, name: matchedCategory.name } : null,
    amountGuess,
    dateGuess,
    looksLikePaymentImage,
  };

  // 推測結果のログ (2026-09-29 追加、一時的な調査用)。Tomから「金額欄が反映されない」との
  // 報告が複数回あり、サーバー側では正しく計算できているように見えるケースがあった。実際に
  // 返す値そのものをログに残すことで、クライアント側の描画問題なのかサーバー側の推測ロジックの
  // 問題なのかを切り分けられるようにする。
  console.log('[receipt-scan] result:', JSON.stringify(result));

  return { text, result };
}

export { ReceiptOcrError };
