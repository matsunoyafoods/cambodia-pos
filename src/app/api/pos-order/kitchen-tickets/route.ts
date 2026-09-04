import { NextResponse } from 'next/server';
import { createPosAdminClient, getPosStoreId } from '@/lib/supabase/admin';
import type { SelectedOption, TranslationMap } from '@/lib/pos-types';

// キッチンモニター機能 (2026-09-03 追加)。Tomからの要望「キッチンはハンディーのように
// キッチンモニターに設定すればキッチンモニターとして使えるようになれば簡単」に対応。紙の
// 厨房伝票 (プリンター) の代わりに、確定・厨房送信された注文品目をタブレット画面へ一覧表示し、
// 「調理完了」をタップすると消える (kitchen_done_at を記録する) だけのシンプルな仕組み。
// 既存の厨房プリンター機能とは独立しており、プリンターを併用している店舗にも影響しない
// (pos.order_items.sent_to_kitchen_at は今まで通り注文確定時にセットされる)。
// 認証なしは他の /api/pos-order/* と同じ理由 (dine連携ログインのCookieは別オリジンのため
// このサーバーから見えず、withPosStaff を使うとキッチンモニター画面自体が読めなくなる)。

const orderItemSelect =
  'id, order_id, menu_id, menu_name, qty, selected_options, sent_to_kitchen_at, kitchen_done_at, kitchen_done_by_name';

// フード/ドリンク区分 (2026-09-04 追加。ドリンカーモニター対応)。品目の menu_id →
// menu_items.category_id → menu_categories.kind で判定する。中カテゴリー自身に
// kind='drink' が設定されていればそれを優先し、未設定 (food のまま) なら親の大カテゴリーの
// kind を見る (大カテゴリーごと「ドリンク」に設定すれば配下もまとめて出せるようにするため)。
// menu_id が無い/カテゴリーが未設定/カテゴリーが見つからない場合は 'food' 扱い (従来通り
// キッチンモニターに表示。挙動に影響を与えないためのデフォルト)。
type CategoryKindRow = { id: string; parent_id: string | null; kind: string };

function resolveKind(categoryId: string | null, categoriesById: Map<string, CategoryKindRow>): 'food' | 'drink' {
  if (!categoryId) return 'food';
  const cat = categoriesById.get(categoryId);
  if (!cat) return 'food';
  if (cat.kind === 'drink') return 'drink';
  if (cat.parent_id) {
    const parent = categoriesById.get(cat.parent_id);
    if (parent?.kind === 'drink') return 'drink';
  }
  return 'food';
}

// GET /api/pos-order/kitchen-tickets : 未対応 (厨房送信済み・調理未完了) の品目一覧と、
// 直近10分以内に完了した品目一覧 (誤操作時の「元に戻す」用) を返す。各品目に kind
// ('food' | 'drink') を付与し、キッチンモニター/ドリンカーモニターはこれで絞り込んで表示する。
export async function GET() {
  const supabase = createPosAdminClient();
  const storeId = getPosStoreId();

  const { data: orders, error: ordersError } = await supabase.from('orders').select('id, table_code').eq('store_id', storeId).eq('status', 'open');
  if (ordersError) return NextResponse.json({ error: ordersError.message }, { status: 500 });

  const orderIds = (orders ?? []).map((o) => o.id);
  if (orderIds.length === 0) {
    return NextResponse.json({ pending: [], recentlyDone: [] });
  }
  const tableCodeByOrderId = new Map((orders ?? []).map((o) => [o.id, o.table_code]));

  const { data: items, error: itemsError } = await supabase
    .from('order_items')
    .select(orderItemSelect)
    .in('order_id', orderIds)
    .not('sent_to_kitchen_at', 'is', null)
    .order('sent_to_kitchen_at', { ascending: true });
  if (itemsError) return NextResponse.json({ error: itemsError.message }, { status: 500 });

  const menuIds = Array.from(new Set((items ?? []).map((it) => it.menu_id).filter((id): id is string => !!id)));
  const categoryIdByMenuId = new Map<string, string | null>();
  // 商品名の多言語訳 (2026-09-04 追加。Tomからの指摘「ここの表示も翻訳されていないね」
  // — キッチン/ドリンクモニターの商品名・オプション選択肢名がスナップショット (注文確定時点の
  // 日本語文字列) のまま表示され、翻訳が反映されていなかった問題への対応)。menu_name /
  // selected_options[].choiceLabel 自体は履歴保持のためスナップショットのままにしつつ、
  // 表示時に menu_id / choiceId で現在の翻訳 (menu_items.translations /
  // menu_option_choices.translations) を引いて画面側で menuText() に渡せるようにする。
  const menuTranslationsByMenuId = new Map<string, TranslationMap | null>();
  if (menuIds.length > 0) {
    const { data: menuItems, error: menuItemsError } = await supabase
      .from('menu_items')
      .select('id, category_id, translations')
      .in('id', menuIds);
    if (menuItemsError) return NextResponse.json({ error: menuItemsError.message }, { status: 500 });
    for (const mi of menuItems ?? []) {
      categoryIdByMenuId.set(mi.id, mi.category_id);
      menuTranslationsByMenuId.set(mi.id, (mi.translations as TranslationMap | null) ?? null);
    }
  }
  const { data: categories, error: categoriesError } = await supabase
    .from('menu_categories')
    .select('id, parent_id, kind')
    .eq('store_id', storeId);
  if (categoriesError) return NextResponse.json({ error: categoriesError.message }, { status: 500 });
  const categoriesById = new Map((categories ?? []).map((c) => [c.id, c as CategoryKindRow]));

  const choiceIds = Array.from(
    new Set(
      (items ?? []).flatMap((it) => ((it.selected_options as SelectedOption[] | null) ?? []).map((o) => o.choiceId).filter(Boolean)),
    ),
  );
  const choiceTranslationsById = new Map<string, TranslationMap | null>();
  if (choiceIds.length > 0) {
    const { data: choiceRows, error: choicesError } = await supabase.from('menu_option_choices').select('id, translations').in('id', choiceIds);
    if (choicesError) return NextResponse.json({ error: choicesError.message }, { status: 500 });
    for (const c of choiceRows ?? []) choiceTranslationsById.set(c.id, (c.translations as TranslationMap | null) ?? null);
  }

  const withTable = (items ?? []).map((it) => ({
    ...it,
    table_code: tableCodeByOrderId.get(it.order_id) ?? null,
    kind: resolveKind(it.menu_id ? (categoryIdByMenuId.get(it.menu_id) ?? null) : null, categoriesById),
    menu_translations: it.menu_id ? (menuTranslationsByMenuId.get(it.menu_id) ?? null) : null,
    selected_options: ((it.selected_options as SelectedOption[] | null) ?? []).map((o) => ({
      ...o,
      translations: choiceTranslationsById.get(o.choiceId) ?? null,
    })),
  }));
  const pending = withTable.filter((it) => !it.kitchen_done_at);

  const recentThreshold = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const recentlyDone = withTable
    .filter((it) => it.kitchen_done_at && it.kitchen_done_at >= recentThreshold)
    .sort((a, b) => (a.kitchen_done_at! < b.kitchen_done_at! ? 1 : -1))
    .slice(0, 20);

  return NextResponse.json({ pending, recentlyDone });
}
