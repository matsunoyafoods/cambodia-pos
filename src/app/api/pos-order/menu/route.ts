import { NextResponse } from 'next/server';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import type { MenuItem } from '@/lib/pos-types';
import { indexCategories, resolveCategoryChain, type CategoryNode } from '@/lib/category-tree';

// レジ画面向け、POSネイティブメニューの公開読み取りエンドポイント (認証なし)。
// /api/pos-order/mode で menuSource が 'pos_native' の店舗でのみ pos-app.tsx から呼ばれる。
// 公開して問題ない情報の範囲 (matsunoya-dine 側の公開 /api/pos/menus と同等の信頼レベル):
// 有効な商品の名前・価格・カテゴリ・オプション (量目・セット選択など) のみ。

type Row = {
  id: string;
  name: string;
  price: number;
  happy_hour_price: number | null;
  image_url: string | null;
  sort_order: number;
  category_id: string | null;
  translations: Record<string, string> | null;
  menu_option_groups: {
    id: string;
    key: string;
    label: string;
    required: boolean;
    sort_order: number;
    translations: Record<string, string> | null;
    menu_option_choices: {
      id: string;
      choice_key: string;
      label: string;
      price_delta: number;
      sort_order: number;
      translations: Record<string, string> | null;
    }[];
  }[];
};

type CategoryRow = { id: string; name: string; sort_order: number; parent_id: string | null; translations: Record<string, string> | null };

export async function GET() {
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const [{ data, error }, { data: categoryRows, error: categoryError }] = await Promise.all([
    supabase
      .from('menu_items')
      .select(
        `id, name, price, happy_hour_price, image_url, sort_order, category_id, translations,
         menu_option_groups ( id, key, label, required, sort_order, translations,
           menu_option_choices ( id, choice_key, label, price_delta, sort_order, translations )
         )`,
      )
      .eq('store_id', storeId)
      .eq('active', true)
      .order('sort_order'),
    supabase
      .from('menu_categories')
      .select('id, name, sort_order, parent_id, translations')
      .eq('store_id', storeId),
  ]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (categoryError) {
    return NextResponse.json({ error: categoryError.message }, { status: 500 });
  }

  const byId = indexCategories((categoryRows ?? []) as CategoryNode[]);
  const categoryTranslationsById = new Map<string, Record<string, string>>(
    ((categoryRows ?? []) as CategoryRow[]).map((c) => [c.id, c.translations ?? {}]),
  );

  // レジ画面タブの並び順は大カテゴリーの sort_order に従う (設定画面「メニュー・商品
  // オプション」から自由に並び替えできる)。sort_order が同じ場合は名前順でタイブレークする。
  const categories = (categoryRows ?? [])
    .filter((c) => !c.parent_id)
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
    .map((c) => c.name);

  // referencedTable での並び順指定が効かない環境でも崩れないよう、念のためここでも整列する。
  const rows = (data ?? []) as unknown as Row[];
  const items: MenuItem[] = rows.map((row) => {
    const resolved = resolveCategoryChain(row.category_id, byId);
    return {
      id: row.id,
      category: resolved?.majorName ?? '未分類',
      categoryId: resolved?.majorId,
      categoryTranslations: resolved ? categoryTranslationsById.get(resolved.majorId) : undefined,
      middleCategory: resolved?.middleName ?? undefined,
      middleCategoryId: resolved?.middleId ?? undefined,
      middleCategoryTranslations: resolved?.middleId ? categoryTranslationsById.get(resolved.middleId) : undefined,
      minorCategory: resolved?.minorName ?? '未分類',
      minorCategoryId: resolved?.minorId,
      minorCategoryTranslations: resolved ? categoryTranslationsById.get(resolved.minorId) : undefined,
      name: row.name,
      translations: row.translations ?? undefined,
      price: Number(row.price),
      happyHourPrice: row.happy_hour_price != null ? Number(row.happy_hour_price) : undefined,
      imageUrl: row.image_url ?? undefined,
      optionGroups: (row.menu_option_groups ?? [])
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((g) => ({
          key: g.key,
          label: g.label,
          required: g.required,
          translations: g.translations ?? undefined,
          choices: (g.menu_option_choices ?? [])
            .slice()
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((c) => ({
              id: c.choice_key,
              label: c.label,
              priceDelta: Number(c.price_delta),
              translations: c.translations ?? undefined,
            })),
        })),
    };
  });

  return NextResponse.json({ items, categories });
}
