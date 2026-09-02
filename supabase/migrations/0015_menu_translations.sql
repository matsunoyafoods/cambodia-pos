-- 多言語化 (2026-09-02)。Tom「多言語化しましょう！日本語、英語、カンボジア語、中国語、韓国語が必要です」への対応。
-- 既存の name/label 列 (日本語) は変更しない。en/km/zh/ko の翻訳は各テーブルに追加する
-- translations (jsonb: {"en": "...", "km": "...", "zh": "...", "ko": "..."}) に保持する。
-- 未翻訳のキーが無い場合は該当言語のUI側で日本語にフォールバックする。

alter table pos.menu_categories
  add column if not exists translations jsonb not null default '{}'::jsonb;

alter table pos.menu_items
  add column if not exists translations jsonb not null default '{}'::jsonb;

alter table pos.menu_option_groups
  add column if not exists translations jsonb not null default '{}'::jsonb;

alter table pos.menu_option_choices
  add column if not exists translations jsonb not null default '{}'::jsonb;
