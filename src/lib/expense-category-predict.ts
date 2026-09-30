import 'server-only';
import type { createPosAdminClient } from '@/lib/supabase/admin';

// Telegramの費目選択ボタンを「登録済み全件」ではなく「予測した上位5件」に絞るための
// ランキングロジック (2026-09-30 追加。Tom「見づらいな。予測して5個以内くらいから
// 選べないの？」への対応。以前は expense_categories を全件ボタンで出していたが、
// 店舗によっては30件以上あり選ぶのが大変だった)。
//
// ランキング方針:
// 1. 同じ仕入れ先 (vendor_guess) で過去に使われた費目を最優先 (回数が多いほど上位)
// 2. 店舗全体でよく使われている費目を次点 (仕入れ先が新規・未登録でも何かしら出せるように)
// 3. 使用実績が同点の費目は、費目マスタの並び順 (sort_order) をそのまま維持
//
// /categories (一覧取得) と /[id]/edit (選択の確定) の両方が全く同じロジックで同じ結果を
// 再現できる必要がある (ボタンのインデックスを後から解決するため) ため、共通関数として
// 1箇所にまとめてある。

type SupabaseAdmin = ReturnType<typeof createPosAdminClient>;

const HISTORY_LIMIT = 300;

export async function getPredictedCategories(
  supabase: SupabaseAdmin,
  storeId: string,
  vendorGuess: string | null,
  limit = 5,
): Promise<string[]> {
  const { data: categoryRows, error: categoryError } = await supabase
    .from('expense_categories')
    .select('name')
    .eq('store_id', storeId)
    .order('sort_order', { ascending: true });
  if (categoryError) throw new Error(categoryError.message);
  const registeredNames = (categoryRows ?? []).map((r) => r.name as string);
  if (registeredNames.length === 0) return [];

  const { data: expenseRows, error: expenseError } = await supabase
    .from('expenses')
    .select('category, vendor')
    .eq('store_id', storeId)
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT);
  if (expenseError) throw new Error(expenseError.message);

  const normalizedVendor = vendorGuess?.trim().toLowerCase() || null;
  const vendorCounts = new Map<string, number>();
  const overallCounts = new Map<string, number>();
  for (const row of expenseRows ?? []) {
    const category = row.category as string;
    overallCounts.set(category, (overallCounts.get(category) ?? 0) + 1);
    if (normalizedVendor && (row.vendor as string | null)?.trim().toLowerCase() === normalizedVendor) {
      vendorCounts.set(category, (vendorCounts.get(category) ?? 0) + 1);
    }
  }

  const ranked = [...registeredNames].sort((a, b) => {
    const scoreA = (vendorCounts.get(a) ?? 0) * 1000 + (overallCounts.get(a) ?? 0);
    const scoreB = (vendorCounts.get(b) ?? 0) * 1000 + (overallCounts.get(b) ?? 0);
    return scoreB - scoreA; // 降順。スコア同点は Array.sort の安定性により sort_order を維持
  });

  return ranked.slice(0, limit);
}
