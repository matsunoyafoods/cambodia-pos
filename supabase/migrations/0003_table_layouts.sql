-- Cambodia POS: テーブルレイアウト (卓 + 柱・カウンター等の障害物) を
-- POS ネイティブ (pos.stores 単位) で永続化するためのテーブル。
-- これまで table-layout-screen.tsx はローカル state のみで、リロードで消えていた。
-- 冪等に書けるようにしており、pos.table_layouts が (旧 0001 ドラフト等で) 既に
-- 存在していても壊さずに必要なカラムだけ追加する。

create table if not exists pos.table_layouts (
  id           uuid primary key default gen_random_uuid(),
  store_id     uuid not null references pos.stores(id) on delete cascade,
  table_code   text not null,           -- 卓番号、または障害物のラベル (「柱1」等)
  kind         text not null default 'table' check (kind in ('table', 'pillar', 'counter', 'wall')),
  seats        integer not null default 4,
  x            integer not null default 0,
  y            integer not null default 0,
  width        integer not null default 84,
  height       integer not null default 64,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (store_id, table_code)
);

alter table pos.table_layouts add column if not exists kind text not null default 'table';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'table_layouts_kind_check'
  ) then
    alter table pos.table_layouts
      add constraint table_layouts_kind_check check (kind in ('table', 'pillar', 'counter', 'wall'));
  end if;
end $$;

alter table pos.table_layouts enable row level security;

grant all on pos.table_layouts to service_role;
