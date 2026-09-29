import { NextResponse } from 'next/server';
import { withPosStaff } from '@/lib/pos-auth';
import { runReceiptScan } from '@/lib/receipt-scan';
import { ReceiptOcrError } from '@/lib/receipt-ocr';

const MAX_BYTES = 5 * 1024 * 1024; // 5MB (スマホカメラ写真を想定。receipt route と同じ上限)
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic']);

// レシートOCRスキャン (2026-09-28 追加。Tom「レシートを読み込んで、既存設定の科目と受領名を
// 自動で選択されるようにしたい。今までにないのは登録しますか？と出る。その場合科目だけ自動で
// 受領側は手入力」への対応)。この時点では expenses テーブルには何も保存しない — 経費登録前の
// 入力補助として、マッチした仕入れ先・費目の候補を返すだけ。実際の登録は通常通り
// POST /api/expenses (この画面のQuickEntryForm) で行う。
//
// OCR・マッチングの実処理は src/lib/receipt-scan.ts (runReceiptScan) に切り出してある
// (2026-09-29。Telegram Bot連携 (bridge/telegram-expense-ocr) からも同じロジックを使うため)。
// このファイルはHTTP側 (認証・ファイル受け取り・レスポンス整形) だけを担当する。
//
// 権限は経費の新規登録 (POST /api/expenses) と同じ part_time 以上 (現場のスタッフもレシート
// スキャンで入力補助を受けられるように)。ただし新規仕入れ先の登録は既存方針通り manager 以上
// のみ (POST /api/settings/expense-vendors) — このエンドポイント自体はマスタ一覧を読むだけで
// 何も書き込まないので、権限はそのままでよい。
export const POST = withPosStaff('part_time', async (_session, req) => {
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: '画像ファイルが見つかりません' }, { status: 400 });
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: 'jpg・png・webp・heic のいずれかの画像を選択してください' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: '画像サイズは5MB以下にしてください' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const base64 = buffer.toString('base64');

  try {
    const { result } = await runReceiptScan(base64);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ReceiptOcrError && err.message === 'ocr_not_configured') {
      return NextResponse.json({ error: 'ocr_not_configured' }, { status: 503 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : 'ocr_failed' }, { status: 502 });
  }
});
