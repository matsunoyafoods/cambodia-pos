-- 商品画像 (メニュー・商品オプション設定画面から登録)。
-- 画像本体は Supabase Storage の public バケット `store-media` に
-- `pos-menu-items/{store_id}/{item_id}.{ext}` として保存し、ここには公開URLのみ持つ。
alter table pos.menu_items add column if not exists image_url text;
