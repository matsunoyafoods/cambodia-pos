import { NextResponse } from 'next/server';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { withPosStaff } from '@/lib/pos-auth';
import { extractReceiptText, findBestMatch, guessAmountFromText, guessDateFromText, guessVendorNameFromText, ReceiptOcrError } from '@/lib/receipt-ocr';
import type { ExpenseCategory, ExpenseVendor } from '@/lib/pos-types';

const MAX_BYTES = 5 * 1024 * 1024; // 5MB (スマホカメラ写真を想定。receipt route と同じ上限)
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic']);

// レシートOCRスキャン (2026-09-28 追加。Tom「レシートを読み込んで、既存設定の科目と受領名を
// 自動で選択されるようにしたい。今までにないのは登録しますか？と出る。その場合科目だけ自動で
// 受領側は手入力」への対応)。この時点では expenses テーブルには何も保存しない — 経費登録前の
// 入力補助として、マッチした仕入れ先・費目の候補を返すだけ。実際の登録は通常通り
// POST /api/expenses (この画面のQuickEntryForm) で行う。
//
// 費目の推測は「同じ仕入れ先の過去の経費 (直近20件) で一番よく使われている費目」を優先する
// (仕入れ先がマッチした場合)。仕入れ先が未登録・不明な場合は、レシート本文とマスタ費目名の
// 文字列一致 (findBestMatch) で推測する — この場合の精度は低め (レシートに費目名そのものが
// 印字されていることは少ない) なので、あくまで best-effort。
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

  let text: string;
  try {
    text = await extractReceiptText(base64);
  } catch (err) {
    if (err instanceof ReceiptOcrError && err.message === 'ocr_not_configured') {
      return NextResponse.json({ error: 'ocr_not_configured' }, { status: 503 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : 'ocr_failed' }, { status: 502 });
  }

  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const [{ data: vendorRows, error: vendorError }, { data: categoryRows, error: categoryError }] = await Promise.all([
    supabase.from('expense_vendors').select('id, name, sort_order').eq('store_id', storeId),
    supabase.from('expense_categories').select('id, name, sort_order').eq('store_id', storeId),
  ]);
  if (vendorError) return NextResponse.json({ error: vendorError.message }, { status: 500 });
  if (categoryError) return NextResponse.json({ error: categoryError.message }, { status: 500 });

  const vendors: ExpenseVendor[] = (vendorRows ?? []).map((r) => ({ id: r.id, name: r.name, sortOrder: r.sort_order }));
  const categories: ExpenseCategory[] = (categoryRows ?? []).map((r) => ({ id: r.id, name: r.name, sortOrder: r.sort_order }));

  const matchedVendor = findBestMatch(text, vendors);
  const vendorNameGuess = matchedVendor ? null : guessVendorNameFromText(text);

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
    matchedCategory = findBestMatch(text, categories);
  }

  const amountGuess = guessAmountFromText(text);
  const dateGuess = guessDateFromText(text);

  return NextResponse.json({
    matchedVendor: matchedVendor ? { id: matchedVendor.id, name: matchedVendor.name } : null,
    vendorNameGuess,
    matchedCategory: matchedCategory ? { id: matchedCategory.id, name: matchedCategory.name } : null,
    amountGuess,
    dateGuess,
  });
});
