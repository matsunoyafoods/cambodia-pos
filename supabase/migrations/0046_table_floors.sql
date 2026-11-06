-- Cambodia POS: テーブルレイアウトの複数階 (フロア) 対応 (2026-11-06)。
-- これまで pos.table_layouts は店舗ごとに1枚の見取り図しか持てず、2階以上ある店舗が使えなかった。
--
-- 設計:
-- - pos.table_floors に店舗ごとのフロア (名前・並び順) を持つ。
-- - pos.table_layouts.floor_id で卓・障害物をフロアに紐付ける。
-- - floor_id が null の項目は「並び順が先頭のフロア」に属するものとして扱う。
--   フロアが1件も無い店舗 (既存店舗すべて) は、これまで通りの1枚レイアウトのまま動作する。
-- - 卓番号 (table_code) の一意制約は従来通り店舗全体 (unique (store_id, table_code)) のまま。
--   注文・卓セッション・予約が table_code で卓を参照しているため、階をまたいでも重複させない。
-- 冪等に書いておく (再実行しても壊れない)。

create table if not exists pos.table_floors (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references pos.stores(id) on delete cascade,
  name        text not null,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (store_id, name)
);

create index if not exists table_floors_store_sort_idx on pos.table_floors (store_id, sort_order);

alter table pos.table_floors enable row level security;
grant all on pos.table_floors to service_role;

-- フロア削除時に卓が宙に浮かないよう restrict (画面側でも「卓が残っている階は削除不可」とする)。
alter table pos.table_layouts
  add column if not exists floor_id uuid references pos.table_floors(id) on delete restrict;

create index if not exists table_layouts_floor_idx on pos.table_layouts (floor_id);
