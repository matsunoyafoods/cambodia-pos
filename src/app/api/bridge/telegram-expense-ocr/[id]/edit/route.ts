import { NextResponse } from 'next/server';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { checkBridgeSecret } from '@/lib/bridge-auth';
import { getPredictedCategories } from '@/lib/expense-category-predict';

type RouteContext = { params: Promise<{ id: string }> };

const EDITABLE_FIELDS = ['amount', 'vendor', 'category'] as const;
type EditableField = (typeof EDITABLE_FIELDS)[number];

// Telegram上で「Amount編集」「Vendor編集」「Expense編集」ボタン→テキスト返信を受けて、
// 確定登録前の下書き (pos.expense_ocr_drafts) の値を書き換える (2026-09-29 追加。
// Tom「テレグラムに間違った内容のメッセージが来た時に...それぞれ編集などできるようにしたい」
// への対応)。
//
// 確定 (confirm) 済み・却下 (rejected) 済みの下書きは編集できない (pending のみ)。
// 実際の pos.expenses への反映は無し。あくまで下書きの値を直すだけで、その後の
// 「✅登録」でこの新しい値が使われる。
export const POST = async (req: Request, context: RouteContext) => {
  const authError = checkBridgeSecret(req);
  if (authError) return authError;

  const { id } = await context.params;
  const body = (await req.json().catch(() => null)) as
    | { field?: string; value?: string; categoryIndex?: number; categoryMode?: string }
    | null;
  const field = body?.field;
  const rawValue = typeof body?.value === 'string' ? body.value.trim() : '';
  // 2026-09-29: 費目編集はPOSの登録済み費目一覧 (/categories と同じ並び順) からボタンで
  // 選ぶ方式に変更したため、自由入力の value ではなく一覧内のインデックスで来る
  // (ABA送金画面には費目に相当する情報が無く、自由入力では表記が割れやすいため)。
  // 2026-09-30: 全件だと選びにくいとの指摘 (Tom) を受け、予測上位5件 ('t') と全件一覧 ('a')
  // のどちらから選んだかを categoryMode で受け取り、同じロジックで再現して解決する。
  const categoryIndex = typeof body?.categoryIndex === 'number' ? body.categoryIndex : null;
  const categoryMode = body?.categoryMode === 't' ? 't' : 'a';

  const isCategoryByIndex = field === 'category' && categoryIndex !== null;
  if (!field || !EDITABLE_FIELDS.includes(field as EditableField) || (!isCategoryByIndex && rawValue.length === 0)) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data: draft, error: draftError } = await supabase
    .from('expense_ocr_drafts')
    .select('id, status, vendor_guess')
    .eq('id', id)
    .eq('store_id', storeId)
    .maybeSingle();
  if (draftError) return NextResponse.json({ error: draftError.message }, { status: 500 });
  if (!draft) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (draft.status !== 'pending') return NextResponse.json({ error: 'already_finalized', status: draft.status }, { status: 409 });

  const update: Record<string, string | number> = {};
  if (field === 'amount') {
    const amount = Number(rawValue.replace(/[,$]/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: 'invalid_amount' }, { status: 400 });
    }
    update.amount_guess = Math.round(amount * 100) / 100;
  } else if (field === 'vendor') {
    if (rawValue.length > 160) return NextResponse.json({ error: 'value_too_long' }, { status: 400 });
    update.vendor_guess = rawValue;
  } else if (isCategoryByIndex && categoryMode === 't') {
    // /categories が predicted として返したのと同じロジックで再現し、インデックスから
    // 費目名を復元する (予測は選択時点の実績次第で動く可能性があるため、厳密には表示時点と
    // ズレる余地はあるが、他の編集操作と同様に結果はカードに表示されすぐ確認できる)。
    let predicted: string[];
    try {
      predicted = await getPredictedCategories(supabase, storeId, (draft.vendor_guess as string | null) ?? null);
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'predict_failed' }, { status: 500 });
    }
    const name = predicted[categoryIndex!];
    if (!name) return NextResponse.json({ error: 'invalid_category' }, { status: 400 });
    update.category_guess = name;
  } else if (isCategoryByIndex) {
    // /categories の全件一覧 ('a') と全く同じ並び順で再取得し、インデックスから費目名を復元する。
    const { data: categoryRows, error: categoryError } = await supabase
      .from('expense_categories')
      .select('name')
      .eq('store_id', storeId)
      .order('sort_order', { ascending: true });
    if (categoryError) return NextResponse.json({ error: categoryError.message }, { status: 500 });
    const categoryRow = categoryRows?.[categoryIndex!];
    if (!categoryRow) return NextResponse.json({ error: 'invalid_category' }, { status: 400 });
    update.category_guess = categoryRow.name;
  } else {
    if (rawValue.length > 160) return NextResponse.json({ error: 'value_too_long' }, { status: 400 });
    update.category_guess = rawValue;
  }

  const { data: updated, error: updateError } = await supabase
    .from('expense_ocr_drafts')
    .update(update)
    .eq('id', id)
    .select('amount_guess, vendor_guess, category_guess, date_guess')
    .single();
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  return NextResponse.json({
    amountGuess: updated.amount_guess,
    vendorName: updated.vendor_guess,
    categoryName: updated.category_guess,
    dateGuess: updated.date_guess,
  });
};
