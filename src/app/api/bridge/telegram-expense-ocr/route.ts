import { NextResponse } from 'next/server';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { checkBridgeSecret } from '@/lib/bridge-auth';
import { runReceiptScan } from '@/lib/receipt-scan';
import { ReceiptOcrError } from '@/lib/receipt-ocr';

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic']);

// TelegramグループのABA送金確認画面をBotが自動で読み取り、POSレジの経費入力に反映する機能
// (2026-09-29 追加。Tom「TelegramグループのABA支払い完了画面をBotが読み取ってPOSレジに自動で
// 入力されているようにしたい」への対応)。
//
// matsunoya-dine 側のTelegram Bot (経費用グループに写真が投稿されると発火) が、この
// エンドポイントに画像を送ってくる。OCR結果がそのまま経費として記録されると誤読時に
// 気づけないため (Tomの希望で「確認してから登録」方式)、ここでは pos.expense_ocr_drafts に
// 下書きを作るだけで、実際の pos.expenses への登録は Telegram 上のボタン確認を経て
// confirm エンドポイントで行う。
//
// 商品の写真等 (ABAの支払い画面ではないもの) が投稿されることもある (Tomの運用は、購入品の
// 写真とABA画面の両方を同じグループに投稿するスタイルのため)。それらは無視したいので、
// OCR結果が「支払い画面らしくない」場合は下書きを作らず skipped を返す。
export const POST = async (req: Request) => {
  const authError = checkBridgeSecret(req);
  if (authError) return authError;

  // 対象グループ以外からの呼び出しは (Bot側で既にフィルタしているはずだが) 念のため
  // サーバー側でも弾く。未設定の場合はチェックをスキップする (開発時等)。
  const allowedChatId = process.env.TELEGRAM_EXPENSE_GROUP_CHAT_ID;

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  const chatId = form?.get('chatId');
  const messageId = form?.get('messageId');
  if (!file || !(file instanceof File) || typeof chatId !== 'string' || typeof messageId !== 'string') {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  if (allowedChatId && chatId !== allowedChatId) {
    return NextResponse.json({ error: 'chat_not_allowed' }, { status: 403 });
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: 'unsupported_image_type' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'image_too_large' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const base64 = buffer.toString('base64');

  let scan: Awaited<ReturnType<typeof runReceiptScan>>['result'];
  try {
    scan = (await runReceiptScan(base64)).result;
  } catch (err) {
    if (err instanceof ReceiptOcrError && err.message === 'ocr_not_configured') {
      return NextResponse.json({ error: 'ocr_not_configured' }, { status: 503 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : 'ocr_failed' }, { status: 502 });
  }

  if (!scan.looksLikePaymentImage) {
    return NextResponse.json({ skipped: true });
  }

  const vendorName = scan.matchedVendor?.name ?? scan.vendorNameGuess ?? null;
  const categoryName = scan.matchedCategory?.name ?? null;

  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data, error } = await supabase
    .from('expense_ocr_drafts')
    .insert({
      store_id: storeId,
      status: 'pending',
      telegram_chat_id: chatId,
      telegram_message_id: messageId,
      amount_guess: scan.amountGuess,
      vendor_guess: vendorName,
      category_guess: categoryName,
      date_guess: scan.dateGuess,
    })
    .select('id')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    skipped: false,
    draftId: data.id,
    amountGuess: scan.amountGuess,
    vendorName,
    categoryName,
    dateGuess: scan.dateGuess,
  });
};
