-- ドリンカーモニター対応 (2026-09-04追加)。Tomからの要望「キッチンモニターに加えて
-- ドリンカーモニターも追加」に対応するため、カテゴリー単位で「フード」か「ドリンク」かを
-- 判定できるように kind 列を追加する。既存カテゴリーは全て 'food' のまま (デフォルト) =
-- 従来通りキッチンモニターに表示される。挙動に影響なし。
--
-- 判定ロジック (アプリ側): 商品 → menu_items.category_id → menu_categories.kind。
-- 中カテゴリー自体に kind='drink' が設定されていればそれを優先し、未設定 (food のまま) なら
-- 親の大カテゴリーの kind を見る (大カテゴリーごと「ドリンク」に設定すれば、配下の中カテゴリー
-- の商品もまとめてドリンカーモニターに出せるようにするため)。
alter table pos.menu_categories add column kind text not null default 'food';
alter table pos.menu_categories add constraint menu_categories_kind_check
  check (kind = any (array['food'::text, 'drink'::text]));
