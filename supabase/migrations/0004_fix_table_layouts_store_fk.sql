-- 0003 の create table if not exists は、実は本セッション以前から存在していた
-- pos.table_layouts (store_id が public.stores を参照する、未修飾の古い定義) に対して
-- no-op だった。そのため table-layout 機能を本番で使うと、
-- pos.stores 側の正しい store_id で insert しても
-- 「table_layouts_store_id_fkey に違反」エラーになっていた。
--
-- 本番では以下を直接実行して確認済み (0 行だったため安全に張り替え):
--   alter table pos.table_layouts drop constraint table_layouts_store_id_fkey;
--   alter table pos.table_layouts add constraint table_layouts_store_id_fkey
--     foreign key (store_id) references pos.stores(id) on delete cascade;
--
-- このファイルはその修正をリポジトリ履歴として残すためのもの。
-- 冪等に書いておく (再実行しても壊れない)。

do $$
begin
  if exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'pos'
      and t.relname = 'table_layouts'
      and c.conname = 'table_layouts_store_id_fkey'
      and pg_get_constraintdef(c.oid) <> 'FOREIGN KEY (store_id) REFERENCES pos.stores(id) ON DELETE CASCADE'
  ) then
    alter table pos.table_layouts drop constraint table_layouts_store_id_fkey;
    alter table pos.table_layouts
      add constraint table_layouts_store_id_fkey
      foreign key (store_id) references pos.stores(id) on delete cascade;
  end if;
end $$;
