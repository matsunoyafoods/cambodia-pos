import { NextResponse } from 'next/server';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { checkBridgeSecret } from '@/lib/bridge-auth';

type RouteContext = { params: Promise<{ id: string }> };

// TelegramでのボタンOK確認を受けて、下書き (expense_ocr_drafts) を実際の経費
// (pos.expenses) として確定登録する (2026-09-29 追加)。
//
// 金額・費目のどちらかが読み取れていない下書きは確定できない (pos.expenses は両方とも
// 必須列のため)。その場合は Bot 側でそもそも確認ボタンを出さない設計にしているが、
// 念のためこちら側でもガードしておく。
export const POST = async (req: Request, context: RouteContext) => {
  const authError = checkBridgeSecret(req);
  if (authError) return authError;

  const { id } = await context.params;
  const body = await req.json().catch(() => null) as { confirmedByTelegram?: string } | null;
  const confirmedByTelegram = typeof body?.confirmedByTelegram === 'string' ? body.confirmedByTelegram.slice(0, 120) : null;

  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data: draft, error: draftError } = await supabase
    .from('expense_ocr_drafts')
    .select('id, status, amount_guess, vendor_guess, category_guess, date_guess')
    .eq('id', id)
    .eq('store_id', storeId)
    .maybeSingle();
  if (draftError) return NextResponse.json({ error: draftError.message }, { status: 500 });
  if (!draft) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (draft.status !== 'pending') return NextResponse.json({ error: 'already_finalized', status: draft.status }, { status: 409 });
  if (draft.amount_guess == null || !draft.category_guess) {
    return NextResponse.json({ error: 'missing_required_fields' }, { status: 422 });
  }

  const note = confirmedByTelegram ? `Telegramで確認: ${confirmedByTelegram}` : 'Telegramで確認';

  const { data: expense, error: insertError } = await supabase
    .from('expenses')
    .insert({
      store_id: storeId,
      date: draft.date_guess ?? new Date().toISOString().slice(0, 10),
      amount_usd: draft.amount_guess,
      category: draft.category_guess,
      vendor: draft.vendor_guess,
      note,
      payment_status: 'paid',
      paid_at: new Date().toISOString(),
      paid_from: 'other', // ABA送金なのでレジ現金ではない
      created_by: null, // Telegram発なのでPOSスタッフに紐付けない
    })
    .select('id, date, amount_usd, category, vendor')
    .single();
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

  const { error: updateError } = await supabase
    .from('expense_ocr_drafts')
    .update({
      status: 'confirmed',
      confirmed_expense_id: expense.id,
      confirmed_by_telegram: confirmedByTelegram,
      confirmed_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  return NextResponse.json({ expense });
};
