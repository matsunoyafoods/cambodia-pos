import { NextResponse } from 'next/server';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { checkBridgeSecret } from '@/lib/bridge-auth';

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
  const body = (await req.json().catch(() => null)) as { field?: string; value?: string } | null;
  const field = body?.field;
  const rawValue = typeof body?.value === 'string' ? body.value.trim() : '';

  if (!field || !EDITABLE_FIELDS.includes(field as EditableField) || rawValue.length === 0) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data: draft, error: draftError } = await supabase
    .from('expense_ocr_drafts')
    .select('id, status')
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
