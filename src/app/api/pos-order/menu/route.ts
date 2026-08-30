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
  menu_option_groups: {
    id: string;
    key: string;
    label: string;
    required: boolean;
    sort_order: number;
    menu_option_choices: { id: string; choice_key: string; label: string; price_delta: number; sort_order: number }[];
  }[];
};

export async function GET() {
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const [{ data, error }, { data: categoryRows, error: categoryError }] = await Promise.all([
    supabase
      .from('menu_items')
      .select(
        `id, name, price, happy_hour_price, image_url, sort_order, category_id,
         menu_option_groups ( id, key, label, required, sort_order,
           menu_option_choices ( id, choice_key, label, price_delta, sort_order )
         )`,
      )
      .eq('store_id', storeId)
      .eq('active', true)
      .order('sort_order'),
    supabase.from('menu_categories').select('id, name, sort_order, parent_id').eq('store_id', storeId),
  ]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (categoryError) {
    return NextResponse.json({ error: categoryError.message }, { status: 500 });
  }

  const byId = indexCategories((categoryRows ?? []) as CategoryNode[]);

  // referencedTable での並び順指定が効かない環境でも崩れないよう、念のためここでも整列する。
  const rows = (data ?? []) as unknown as Row[];
  const items: MenuItem[] = rows.map((row) => {
    const resolved = resolveCategoryChain(row.category_id, byId);
    return {
      id: row.id,
      category: resolved?.majorName ?? '未分類',
      middleCategory: resolved?.middleName ?? undefined,
      minorCategory: resolved?.minorName ?? '未分類',
      name: row.name,
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
          choices: (g.menu_option_choices ?? [])
            .slice()
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((c) => ({
              id: c.choice_key,
              label: c.label,
              priceDelta: Number(c.price_delta),
            })),
        })),
    };
  });

  return NextResponse.json({ items });
}
