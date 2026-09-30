import { NextResponse } from 'next/server';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { checkBridgeSecret } from '@/lib/bridge-auth';
import { getPredictedCategories } from '@/lib/expense-category-predict';

// TelegramのExpense編集ボタンで「POSレジに登録済みの費目一覧」をそのまま選べるようにする
// ためのエンドポイント (2026-09-29 追加。Tom「そもそもABAの画面では費目がわからない。
// POSレジに表示する費目をテレグラムにひっぱってこれますか」への対応)。
//
// ABA送金確認画面には費目に相当する情報が一切無いため、OCR/文字列マッチでの推測には
// 原理的に限界がある。ならばTelegram側でも自由入力ではなく、POSの設定画面
// (/api/settings/expense-categories と同じ pos.expense_categories テーブル・同じ並び順
// sort_order昇順) から選ばせるのが確実、という判断。
//
// 全件の順序はPOS側の一覧と完全に一致させる必要がある (Bot側はここで返した配列の
// インデックスを callback_data に載せて選択結果を送り返してくるため、並びがズレると
// 違う費目が選ばれてしまう)。
//
// 2026-09-30 追加: 店舗によっては費目が30件以上あり、全件をボタンで並べると選びにくい
// (Tom「見づらいな。予測して5個以内くらいから選べないの？」)。?draftId= を付けると、
// その下書きの仕入れ先から予測した上位5件も predicted として返す。Bot側はまず
// predicted を出し、無ければ全件 (categories) を見せるボタンに誘導する想定。
export const GET = async (req: Request) => {
  const authError = checkBridgeSecret(req);
  if (authError) return authError;

  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data, error } = await supabase
    .from('expense_categories')
    .select('name')
    .eq('store_id', storeId)
    .order('sort_order', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const categories = (data ?? []).map((r) => r.name);

  const draftId = new URL(req.url).searchParams.get('draftId');
  let predicted: string[] = [];
  if (draftId) {
    const { data: draft } = await supabase
      .from('expense_ocr_drafts')
      .select('vendor_guess')
      .eq('id', draftId)
      .eq('store_id', storeId)
      .maybeSingle();
    try {
      predicted = await getPredictedCategories(supabase, storeId, (draft?.vendor_guess as string | null) ?? null);
    } catch (err) {
      console.error('[telegram-expense-ocr/categories] predict failed:', err);
    }
  }

  return NextResponse.json({ categories, predicted });
};
