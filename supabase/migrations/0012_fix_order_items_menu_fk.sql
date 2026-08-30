-- 0011 と同じ根本原因: pos.order_items.menu_id が旧スキーマの public.menu_items(id) を参照
-- したままだった。POS ネイティブのメニュー商品は pos.menu_items に存在するため、
-- 「注文確定」で order_items へ実際に書き込もうとすると外部キー違反 (order_items_menu_id_fkey)
-- が発生することを検出した。pos.menu_items(id) を参照するよう修正する。
-- menu_id は NOT NULL のため ON DELETE 挙動は元の制約と同じ NO ACTION のまま (商品削除時に
-- 注文履歴が残っていれば削除がブロックされる、という元々の安全側の挙動を変えない)。
-- pos.order_items は現時点で0件のためデータ移行は不要。
alter table pos.order_items drop constraint if exists order_items_menu_id_fkey;
alter table pos.order_items add constraint order_items_menu_id_fkey foreign key (menu_id) references pos.menu_items(id);
