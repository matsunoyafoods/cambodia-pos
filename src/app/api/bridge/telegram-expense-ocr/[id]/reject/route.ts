import { NextResponse } from 'next/server';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { checkBridgeSecret } from '@/lib/bridge-auth';

type RouteContext = { params: Promise<{ id: string }> };

// Telegramでの「❌無視」ボタンを受けて、下書きを却下する (2026-09-29 追加)。
// 実際の経費レコードは何も作らない。
export const POST = async (req: Request, context: RouteContext) => {
  const authError = checkBridgeSecret(req);
  if (authError) return authError;

  const { id } = await context.params;
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

  const { error: updateError } = await supabase
    .from('expense_ocr_drafts')
    .update({ status: 'rejected', confirmed_at: new Date().toISOString() })
    .eq('id', id);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  return NextResponse.json({ ok: true });
};
