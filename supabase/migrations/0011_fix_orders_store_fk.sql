-- pos.orders.store_id は元々 public.stores(id) (matsunoya-dine 側のスキーマ) を参照する外部キーの
-- ままだったが、pos.staff / pos.menu_categories / pos.menu_items / pos.table_sessions / pos.reservations
-- など他の POS ネイティブテーブルは全て pos.stores(id) を参照するよう既に統一されている。
-- pos.orders は今回 (0010_category_tree_and_orders.sql) 実際に書き込みが始まるまで
-- 0件のまま放置されていたため、この不整合がこれまで表面化していなかった。
-- 「注文確定」機能の実動作確認で、店舗が pos.stores にしか存在しない (public.stores には無い)
-- ケースで外部キー違反 (orders_store_id_fkey) が発生することを検出したため、他テーブルと同じ
-- pos.stores(id) 参照に修正する。pos.orders は現時点で0件のためデータ移行は不要。
alter table pos.orders drop constraint if exists orders_store_id_fkey;
alter table pos.orders add constraint orders_store_id_fkey foreign key (store_id) references pos.stores(id) on delete cascade;
