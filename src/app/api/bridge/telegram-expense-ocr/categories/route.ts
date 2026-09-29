import { NextResponse } from 'next/server';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import { checkBridgeSecret } from '@/lib/bridge-auth';

// TelegramのExpense編集ボタンで「POSレジに登録済みの費目一覧」をそのまま選べるようにする
// ためのエンドポイント (2026-09-29 追加。Tom「そもそもABAの画面では費目がわからない。
// POSレジに表示する費目をテレグラムにひっぱってこれますか」への対応)。
//
// ABA送金確認画面には費目に相当する情報が一切無いため、OCR/文字列マッチでの推測には
// 原理的に限界がある。ならばTelegram側でも自由入力ではなく、POSの設定画面
// (/api/settings/expense-categories と同じ pos.expense_categories テーブル・同じ並び順
// sort_order昇順) から選ばせるのが確実、という判断。
//
// 順序はPOS側の一覧と完全に一致させる必要がある (Bot側はここで返した配列のインデックスを
// callback_data に載せて選択結果を送り返してくるため、並びがズレると違う費目が選ばれてしまう)。
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

  return NextResponse.json({ categories: (data ?? []).map((r) => r.name) });
};
