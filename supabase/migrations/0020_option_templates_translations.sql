-- オプションテンプレート (「ライスorパン」「ランチドリンク」等、複数商品で使い回す ひな形) の
-- 管理画面表示を多言語対応 (2026-09-04)。
-- 商品ごとの実データ (menu_option_groups/menu_option_choices) には0015_menu_translationsで
-- translations 列を追加済みだが、それとは別テーブルであるテンプレート
-- (menu_option_group_templates/menu_option_choice_templates) には未対応だったため追加する。
-- Tomの指摘「オプションが翻訳されていない」への対応。

alter table pos.menu_option_group_templates
  add column if not exists translations jsonb not null default '{}'::jsonb;

alter table pos.menu_option_choice_templates
  add column if not exists translations jsonb not null default '{}'::jsonb;
