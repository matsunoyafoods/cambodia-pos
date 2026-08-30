-- Cambodia POS: I'mHungry454 メニュー一括登録 (POS単体運用モード用)
-- 添付の店内メニュー(7ページ)から抽出。既にこの店舗にメニューがある場合は二重登録を避けるため何もしない。
-- 対象店舗: I'm hungry454 (pos.stores.id = e5fd7313-71d0-464d-8637-95142ca087a2)

do $mainblock$
declare
  v_store_id uuid := 'e5fd7313-71d0-464d-8637-95142ca087a2';
  v_item_id uuid;
  v_group_id uuid;
begin
  if exists (select 1 from pos.menu_items where store_id = v_store_id) then
    raise notice 'pos.menu_items already has rows for this store; skipping seed to avoid duplicates.';
    return;
  end if;

  -- ============ カテゴリ ============
  insert into pos.menu_categories (store_id, name, sort_order) values (v_store_id, 'ステーキ', 10) on conflict (store_id, name) do nothing;
  insert into pos.menu_categories (store_id, name, sort_order) values (v_store_id, 'ステーキ&ハンバーグセット', 20) on conflict (store_id, name) do nothing;
  insert into pos.menu_categories (store_id, name, sort_order) values (v_store_id, 'ハンバーグステーキ', 30) on conflict (store_id, name) do nothing;
  insert into pos.menu_categories (store_id, name, sort_order) values (v_store_id, 'チキンステーキ', 40) on conflict (store_id, name) do nothing;
  insert into pos.menu_categories (store_id, name, sort_order) values (v_store_id, 'トッピング', 50) on conflict (store_id, name) do nothing;
  insert into pos.menu_categories (store_id, name, sort_order) values (v_store_id, 'サイドメニュー', 60) on conflict (store_id, name) do nothing;
  insert into pos.menu_categories (store_id, name, sort_order) values (v_store_id, 'スープ・デザート', 70) on conflict (store_id, name) do nothing;
  insert into pos.menu_categories (store_id, name, sort_order) values (v_store_id, 'サラダ', 80) on conflict (store_id, name) do nothing;
  insert into pos.menu_categories (store_id, name, sort_order) values (v_store_id, 'パスタ', 90) on conflict (store_id, name) do nothing;
  insert into pos.menu_categories (store_id, name, sort_order) values (v_store_id, 'プロテイン', 100) on conflict (store_id, name) do nothing;
  insert into pos.menu_categories (store_id, name, sort_order) values (v_store_id, 'バーガー', 110) on conflict (store_id, name) do nothing;
  insert into pos.menu_categories (store_id, name, sort_order) values (v_store_id, '誕生日テンダーロイン', 120) on conflict (store_id, name) do nothing;
  insert into pos.menu_categories (store_id, name, sort_order) values (v_store_id, 'ビール', 130) on conflict (store_id, name) do nothing;
  insert into pos.menu_categories (store_id, name, sort_order) values (v_store_id, 'ワイン', 140) on conflict (store_id, name) do nothing;
  insert into pos.menu_categories (store_id, name, sort_order) values (v_store_id, 'ウイスキー', 150) on conflict (store_id, name) do nothing;
  insert into pos.menu_categories (store_id, name, sort_order) values (v_store_id, '焼酎', 160) on conflict (store_id, name) do nothing;
  insert into pos.menu_categories (store_id, name, sort_order) values (v_store_id, 'カクテル', 170) on conflict (store_id, name) do nothing;
  insert into pos.menu_categories (store_id, name, sort_order) values (v_store_id, 'ソフトドリンク', 180) on conflict (store_id, name) do nothing;
  insert into pos.menu_categories (store_id, name, sort_order) values (v_store_id, '飲み放題', 190) on conflict (store_id, name) do nothing;

  -- ============ 商品 ============
  -- Hungry Sukiyaki Plate (ステーキ)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'ステーキ'), 'Hungry Sukiyaki Plate', 5.9, 10) returning id into v_item_id;
  insert into pos.menu_option_groups (menu_id, key, label, required, sort_order) values (v_item_id, 'weight', '量目を選択', true, 0) returning id into v_group_id;
  insert into pos.menu_option_choices (group_id, choice_key, label, price_delta, sort_order) values (v_group_id, '100g', '100g', 0, 0);
  insert into pos.menu_option_choices (group_id, choice_key, label, price_delta, sort_order) values (v_group_id, '200g', '200g', 3.9, 10);
  insert into pos.menu_option_choices (group_id, choice_key, label, price_delta, sort_order) values (v_group_id, '300g', '300g', 6.9, 20);

  -- Steak Basic (OG Beef Misuji) (ステーキ)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'ステーキ'), 'Steak Basic (OG Beef Misuji)', 7.9, 20) returning id into v_item_id;
  insert into pos.menu_option_groups (menu_id, key, label, required, sort_order) values (v_item_id, 'weight', '量目を選択', true, 0) returning id into v_group_id;
  insert into pos.menu_option_choices (group_id, choice_key, label, price_delta, sort_order) values (v_group_id, '120g', '120g', 0, 0);
  insert into pos.menu_option_choices (group_id, choice_key, label, price_delta, sort_order) values (v_group_id, '240g', '240g', 6.9, 10);
  insert into pos.menu_option_choices (group_id, choice_key, label, price_delta, sort_order) values (v_group_id, '360g', '360g', 13.8, 20);

  -- Tenderloin Steak (Australian) (ステーキ)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'ステーキ'), 'Tenderloin Steak (Australian)', 12.0, 30) returning id into v_item_id;
  insert into pos.menu_option_groups (menu_id, key, label, required, sort_order) values (v_item_id, 'weight', '量目を選択', true, 0) returning id into v_group_id;
  insert into pos.menu_option_choices (group_id, choice_key, label, price_delta, sort_order) values (v_group_id, '100g', '100g', 0, 0);
  insert into pos.menu_option_choices (group_id, choice_key, label, price_delta, sort_order) values (v_group_id, '200g', '200g', 10.0, 10);

  -- US Premium Tenderloin (ステーキ)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'ステーキ'), 'US Premium Tenderloin', 21.5, 40) returning id into v_item_id;
  insert into pos.menu_option_groups (menu_id, key, label, required, sort_order) values (v_item_id, 'weight', '量目を選択', true, 0) returning id into v_group_id;
  insert into pos.menu_option_choices (group_id, choice_key, label, price_delta, sort_order) values (v_group_id, '100g', '100g', 0, 0);
  insert into pos.menu_option_choices (group_id, choice_key, label, price_delta, sort_order) values (v_group_id, '200g', '200g', 21.5, 10);

  -- Sukiyaki 50g + Hamburg 200g (ステーキ&ハンバーグセット)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'ステーキ&ハンバーグセット'), 'Sukiyaki 50g + Hamburg 200g', 10.8, 10);

  -- Steak Basic 120g + Hamburg 200g (ステーキ&ハンバーグセット)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'ステーキ&ハンバーグセット'), 'Steak Basic 120g + Hamburg 200g', 14.3, 20);

  -- Tenderloin 100g + Hamburg 200g (ステーキ&ハンバーグセット)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'ステーキ&ハンバーグセット'), 'Tenderloin 100g + Hamburg 200g', 17.0, 30);

  -- 200g Hamburg Steak (ハンバーグステーキ)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'ハンバーグステーキ'), '200g Hamburg Steak', 6.9, 10);

  -- 200g Cheese Fondue Hamburg (ハンバーグステーキ)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'ハンバーグステーキ'), '200g Cheese Fondue Hamburg', 7.9, 20);

  -- Teriyaki Chicken (チキンステーキ)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'チキンステーキ'), 'Teriyaki Chicken', 5.9, 10) returning id into v_item_id;
  insert into pos.menu_option_groups (menu_id, key, label, required, sort_order) values (v_item_id, 'weight', '量目を選択', true, 0) returning id into v_group_id;
  insert into pos.menu_option_choices (group_id, choice_key, label, price_delta, sort_order) values (v_group_id, '200g', '200g', 0, 0);
  insert into pos.menu_option_choices (group_id, choice_key, label, price_delta, sort_order) values (v_group_id, '400g', '400g', 3.0, 10);

  -- 白米 (トッピング)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'トッピング'), '白米', 0.75, 10) returning id into v_item_id;
  insert into pos.menu_option_groups (menu_id, key, label, required, sort_order) values (v_item_id, 'size', 'サイズを選択', true, 0) returning id into v_group_id;
  insert into pos.menu_option_choices (group_id, choice_key, label, price_delta, sort_order) values (v_group_id, '150g', '150g', 0, 0);
  insert into pos.menu_option_choices (group_id, choice_key, label, price_delta, sort_order) values (v_group_id, '250g', '250g', 0.25, 10);

  -- Soft Egg (トッピング)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'トッピング'), 'Soft Egg', 0.75, 20);

  -- Kimchi (トッピング)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'トッピング'), 'Kimchi', 0.75, 30);

  -- Salmon Carpaccio (サイドメニュー)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'サイドメニュー'), 'Salmon Carpaccio', 7.9, 10);

  -- White Fish Fry (4p) (サイドメニュー)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'サイドメニュー'), 'White Fish Fry (4p)', 3.9, 20);

  -- Macaroni Gratin (サイドメニュー)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'サイドメニュー'), 'Macaroni Gratin', 5.9, 30);

  -- Sausage (サイドメニュー)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'サイドメニュー'), 'Sausage', 3.9, 40) returning id into v_item_id;
  insert into pos.menu_option_groups (menu_id, key, label, required, sort_order) values (v_item_id, 'size', 'サイズを選択', true, 0) returning id into v_group_id;
  insert into pos.menu_option_choices (group_id, choice_key, label, price_delta, sort_order) values (v_group_id, '4pcs', '4pcs', 0, 0);
  insert into pos.menu_option_choices (group_id, choice_key, label, price_delta, sort_order) values (v_group_id, '6pcs', '6pcs', 1.6, 10);

  -- Fried Chicken Wings (サイドメニュー)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'サイドメニュー'), 'Fried Chicken Wings', 2.9, 50) returning id into v_item_id;
  insert into pos.menu_option_groups (menu_id, key, label, required, sort_order) values (v_item_id, 'size', 'サイズを選択', true, 0) returning id into v_group_id;
  insert into pos.menu_option_choices (group_id, choice_key, label, price_delta, sort_order) values (v_group_id, '3p', '3p', 0, 0);
  insert into pos.menu_option_choices (group_id, choice_key, label, price_delta, sort_order) values (v_group_id, '5p', '5p', 2.0, 10);

  -- French Fries (サイドメニュー)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'サイドメニュー'), 'French Fries', 2.9, 60);

  -- Chicken Nuggets (5p) (サイドメニュー)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'サイドメニュー'), 'Chicken Nuggets (5p)', 2.9, 70);

  -- Edamame (サイドメニュー)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'サイドメニュー'), 'Edamame', 2.9, 80);

  -- Kids Plate (サイドメニュー)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'サイドメニュー'), 'Kids Plate', 3.5, 90);

  -- Corn Soup (スープ・デザート)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'スープ・デザート'), 'Corn Soup', 2.5, 10);

  -- Miso Soup (スープ・デザート)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'スープ・デザート'), 'Miso Soup', 1.5, 20);

  -- Vanilla Ice Cream (スープ・デザート)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'スープ・デザート'), 'Vanilla Ice Cream', 1.0, 30);

  -- Chocolate Ice Cream (スープ・デザート)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'スープ・デザート'), 'Chocolate Ice Cream', 1.0, 40);

  -- MATCHA Ice Cream (スープ・デザート)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'スープ・デザート'), 'MATCHA Ice Cream', 2.0, 50);

  -- All-you-can-eat 食べ放題サラダバー (サラダ)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'サラダ'), 'All-you-can-eat 食べ放題サラダバー', 1.5, 10);

  -- Bolognese (パスタ)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'パスタ'), 'Bolognese', 6.9, 10);

  -- Carbonara (パスタ)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'パスタ'), 'Carbonara', 6.9, 20);

  -- Chicken Broccoli (プロテイン)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'プロテイン'), 'Chicken Broccoli', 4.9, 10);

  -- Hungry BIG Burger (バーガー)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'バーガー'), 'Hungry BIG Burger', 8.0, 10) returning id into v_item_id;
  insert into pos.menu_option_groups (menu_id, key, label, required, sort_order) values (v_item_id, 'set', 'セット', true, 0) returning id into v_group_id;
  insert into pos.menu_option_choices (group_id, choice_key, label, price_delta, sort_order) values (v_group_id, 'single', '単品', 0, 0);
  insert into pos.menu_option_choices (group_id, choice_key, label, price_delta, sort_order) values (v_group_id, 'combo', 'コンボ(+フライドポテト・コーラ)', 2.0, 10);

  -- Classic W Burger (バーガー)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'バーガー'), 'Classic W Burger', 6.5, 20) returning id into v_item_id;
  insert into pos.menu_option_groups (menu_id, key, label, required, sort_order) values (v_item_id, 'set', 'セット', true, 0) returning id into v_group_id;
  insert into pos.menu_option_choices (group_id, choice_key, label, price_delta, sort_order) values (v_group_id, 'single', '単品', 0, 0);
  insert into pos.menu_option_choices (group_id, choice_key, label, price_delta, sort_order) values (v_group_id, 'combo', 'コンボ(+フライドポテト・コーラ)', 2.0, 10);

  -- Classic Burger (バーガー)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'バーガー'), 'Classic Burger', 5.0, 30) returning id into v_item_id;
  insert into pos.menu_option_groups (menu_id, key, label, required, sort_order) values (v_item_id, 'set', 'セット', true, 0) returning id into v_group_id;
  insert into pos.menu_option_choices (group_id, choice_key, label, price_delta, sort_order) values (v_group_id, 'single', '単品', 0, 0);
  insert into pos.menu_option_choices (group_id, choice_key, label, price_delta, sort_order) values (v_group_id, 'combo', 'コンボ(+フライドポテト・コーラ)', 2.0, 10);

  -- Cheese Burger (バーガー)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'バーガー'), 'Cheese Burger', 3.0, 40) returning id into v_item_id;
  insert into pos.menu_option_groups (menu_id, key, label, required, sort_order) values (v_item_id, 'patty', 'パティを選択', true, 0) returning id into v_group_id;
  insert into pos.menu_option_choices (group_id, choice_key, label, price_delta, sort_order) values (v_group_id, 'single', 'Single', 0, 0);
  insert into pos.menu_option_choices (group_id, choice_key, label, price_delta, sort_order) values (v_group_id, 'double', 'Double', 1.5, 10);
  insert into pos.menu_option_choices (group_id, choice_key, label, price_delta, sort_order) values (v_group_id, 'triple', 'Triple', 2.5, 20);
  insert into pos.menu_option_groups (menu_id, key, label, required, sort_order) values (v_item_id, 'set', 'セット', true, 10) returning id into v_group_id;
  insert into pos.menu_option_choices (group_id, choice_key, label, price_delta, sort_order) values (v_group_id, 'single', '単品', 0, 0);
  insert into pos.menu_option_choices (group_id, choice_key, label, price_delta, sort_order) values (v_group_id, 'combo', 'コンボ(+フライドポテト・コーラ)', 2.0, 10);

  -- Fish Burger (バーガー)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'バーガー'), 'Fish Burger', 3.5, 50) returning id into v_item_id;
  insert into pos.menu_option_groups (menu_id, key, label, required, sort_order) values (v_item_id, 'set', 'セット', true, 0) returning id into v_group_id;
  insert into pos.menu_option_choices (group_id, choice_key, label, price_delta, sort_order) values (v_group_id, 'single', '単品', 0, 0);
  insert into pos.menu_option_choices (group_id, choice_key, label, price_delta, sort_order) values (v_group_id, 'combo', 'コンボ(+フライドポテト・コーラ)', 2.0, 10);

  -- Teriyaki Burger (バーガー)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'バーガー'), 'Teriyaki Burger', 4.5, 60) returning id into v_item_id;
  insert into pos.menu_option_groups (menu_id, key, label, required, sort_order) values (v_item_id, 'set', 'セット', true, 0) returning id into v_group_id;
  insert into pos.menu_option_choices (group_id, choice_key, label, price_delta, sort_order) values (v_group_id, 'single', '単品', 0, 0);
  insert into pos.menu_option_choices (group_id, choice_key, label, price_delta, sort_order) values (v_group_id, 'combo', 'コンボ(+フライドポテト・コーラ)', 2.0, 10);

  -- テンダーロインステーキブロック(Australian)(要予約・前日までの予約制) (誕生日テンダーロイン)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = '誕生日テンダーロイン'), 'テンダーロインステーキブロック(Australian)(要予約・前日までの予約制)', 110.0, 10) returning id into v_item_id;
  insert into pos.menu_option_groups (menu_id, key, label, required, sort_order) values (v_item_id, 'weight', '量目を選択', true, 0) returning id into v_group_id;
  insert into pos.menu_option_choices (group_id, choice_key, label, price_delta, sort_order) values (v_group_id, '1000g', '1000g', 0, 0);
  insert into pos.menu_option_choices (group_id, choice_key, label, price_delta, sort_order) values (v_group_id, '1500g', '1500g', 50.0, 10);

  -- US Premium テンダーロインブロック(要予約・前日までの予約制) (誕生日テンダーロイン)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = '誕生日テンダーロイン'), 'US Premium テンダーロインブロック(要予約・前日までの予約制)', 200.0, 20) returning id into v_item_id;
  insert into pos.menu_option_groups (menu_id, key, label, required, sort_order) values (v_item_id, 'weight', '量目を選択', true, 0) returning id into v_group_id;
  insert into pos.menu_option_choices (group_id, choice_key, label, price_delta, sort_order) values (v_group_id, '1000g', '1000g', 0, 0);
  insert into pos.menu_option_choices (group_id, choice_key, label, price_delta, sort_order) values (v_group_id, '1500g', '1500g', 100.0, 10);

  -- 生ビール グラス (ビール)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'ビール'), '生ビール グラス', 1.2, 10);

  -- 生ビール ピッチャー(1500ml) (ビール)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'ビール'), '生ビール ピッチャー(1500ml)', 5.5, 20);

  -- 生ビール タワー(3000ml) (ビール)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'ビール'), '生ビール タワー(3000ml)', 10.0, 30);

  -- ハウスワイン(グラス) (ワイン)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'ワイン'), 'ハウスワイン(グラス)', 3.0, 10);

  -- スタンダードワイン (ワイン)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'ワイン'), 'スタンダードワイン', 4.0, 20) returning id into v_item_id;
  insert into pos.menu_option_groups (menu_id, key, label, required, sort_order) values (v_item_id, 'size', 'サイズを選択', true, 0) returning id into v_group_id;
  insert into pos.menu_option_choices (group_id, choice_key, label, price_delta, sort_order) values (v_group_id, 'glass', 'グラス', 0, 0);
  insert into pos.menu_option_choices (group_id, choice_key, label, price_delta, sort_order) values (v_group_id, 'bottle', 'ボトル', 15.0, 10);

  -- プレミアムワイン (ワイン)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'ワイン'), 'プレミアムワイン', 7.0, 30) returning id into v_item_id;
  insert into pos.menu_option_groups (menu_id, key, label, required, sort_order) values (v_item_id, 'size', 'サイズを選択', true, 0) returning id into v_group_id;
  insert into pos.menu_option_choices (group_id, choice_key, label, price_delta, sort_order) values (v_group_id, 'glass', 'グラス', 0, 0);
  insert into pos.menu_option_choices (group_id, choice_key, label, price_delta, sort_order) values (v_group_id, 'bottle', 'ボトル', 20.0, 10);

  -- 角瓶(Kakubin) (ウイスキー)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'ウイスキー'), '角瓶(Kakubin)', 3.5, 10) returning id into v_item_id;
  insert into pos.menu_option_groups (menu_id, key, label, required, sort_order) values (v_item_id, 'size', 'サイズを選択', true, 0) returning id into v_group_id;
  insert into pos.menu_option_choices (group_id, choice_key, label, price_delta, sort_order) values (v_group_id, 'glass', 'グラス', 0, 0);
  insert into pos.menu_option_choices (group_id, choice_key, label, price_delta, sort_order) values (v_group_id, 'bottle', 'ボトル', 41.5, 10);

  -- JAMESON (ウイスキー)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'ウイスキー'), 'JAMESON', 3.5, 20) returning id into v_item_id;
  insert into pos.menu_option_groups (menu_id, key, label, required, sort_order) values (v_item_id, 'size', 'サイズを選択', true, 0) returning id into v_group_id;
  insert into pos.menu_option_choices (group_id, choice_key, label, price_delta, sort_order) values (v_group_id, 'glass', 'グラス', 0, 0);
  insert into pos.menu_option_choices (group_id, choice_key, label, price_delta, sort_order) values (v_group_id, 'bottle', 'ボトル', 41.5, 10);

  -- COMMISSIONER(グラス) (ウイスキー)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'ウイスキー'), 'COMMISSIONER(グラス)', 3.5, 30);

  -- ARAWAZA (焼酎)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = '焼酎'), 'ARAWAZA', 3.5, 10) returning id into v_item_id;
  insert into pos.menu_option_groups (menu_id, key, label, required, sort_order) values (v_item_id, 'size', 'サイズを選択', true, 0) returning id into v_group_id;
  insert into pos.menu_option_choices (group_id, choice_key, label, price_delta, sort_order) values (v_group_id, 'glass', 'グラス', 0, 0);
  insert into pos.menu_option_choices (group_id, choice_key, label, price_delta, sort_order) values (v_group_id, 'bottle', 'ボトル', 34.5, 10);

  -- DAIYAME (焼酎)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = '焼酎'), 'DAIYAME', 3.5, 20) returning id into v_item_id;
  insert into pos.menu_option_groups (menu_id, key, label, required, sort_order) values (v_item_id, 'size', 'サイズを選択', true, 0) returning id into v_group_id;
  insert into pos.menu_option_choices (group_id, choice_key, label, price_delta, sort_order) values (v_group_id, 'glass', 'グラス', 0, 0);
  insert into pos.menu_option_choices (group_id, choice_key, label, price_delta, sort_order) values (v_group_id, 'bottle', 'ボトル', 34.5, 10);

  -- いいちこ (焼酎)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = '焼酎'), 'いいちこ', 3.5, 30) returning id into v_item_id;
  insert into pos.menu_option_groups (menu_id, key, label, required, sort_order) values (v_item_id, 'size', 'サイズを選択', true, 0) returning id into v_group_id;
  insert into pos.menu_option_choices (group_id, choice_key, label, price_delta, sort_order) values (v_group_id, 'glass', 'グラス', 0, 0);
  insert into pos.menu_option_choices (group_id, choice_key, label, price_delta, sort_order) values (v_group_id, 'bottle', 'ボトル', 34.5, 10);

  -- ライムサワー (カクテル)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'カクテル'), 'ライムサワー', 3.5, 10);

  -- ピーチソーダ (カクテル)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'カクテル'), 'ピーチソーダ', 3.5, 20);

  -- カシスオレンジ (カクテル)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'カクテル'), 'カシスオレンジ', 3.5, 30);

  -- ジントニック (カクテル)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'カクテル'), 'ジントニック', 3.5, 40);

  -- カシスソーダ (カクテル)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'カクテル'), 'カシスソーダ', 3.5, 50);

  -- カンポットハイボール (カクテル)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'カクテル'), 'カンポットハイボール', 3.5, 60);

  -- プレミアムビタミンジュース (ソフトドリンク)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'ソフトドリンク'), 'プレミアムビタミンジュース', 3.5, 10);

  -- チアトロピカルジュース (ソフトドリンク)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'ソフトドリンク'), 'チアトロピカルジュース', 3.5, 20);

  -- オレンジジュース (ソフトドリンク)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'ソフトドリンク'), 'オレンジジュース', 1.5, 30);

  -- コーラ (ソフトドリンク)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'ソフトドリンク'), 'コーラ', 1.5, 40);

  -- コーラ(カロリーゼロ) (ソフトドリンク)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'ソフトドリンク'), 'コーラ(カロリーゼロ)', 1.5, 50);

  -- スプライト (ソフトドリンク)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'ソフトドリンク'), 'スプライト', 1.5, 60);

  -- ソーダ (ソフトドリンク)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'ソフトドリンク'), 'ソーダ', 1.5, 70);

  -- お水 (ソフトドリンク)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = 'ソフトドリンク'), 'お水', 1.0, 80);

  -- 飲み放題 60分 (飲み放題)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = '飲み放題'), '飲み放題 60分', 7.0, 10);

  -- 飲み放題 延長30分 (飲み放題)
  insert into pos.menu_items (store_id, category_id, name, price, sort_order) values (v_store_id, (select id from pos.menu_categories where store_id = v_store_id and name = '飲み放題'), '飲み放題 延長30分', 4.0, 20);

  raise notice 'menu seed complete: % categories, % items', (select count(*) from pos.menu_categories where store_id = v_store_id), (select count(*) from pos.menu_items where store_id = v_store_id);
end $mainblock$;
