-- 2026-09-29: expense_ocr_drafts.store_id の参照先を pos.stores(id) に修正。
--
-- 0032 で public.stores(id) を参照するよう作ったが、実際にランタイムで使われる
-- POS_STORE_ID (getPosStoreId()) は pos.expense_categories / pos.expense_vendors と
-- 同じ「pos.stores」側の store_id だった (Tomと一緒にSupabase Studioで
-- pg_constraint を確認して判明。pos.expenses.store_id には現状そもそも外部キー制約が
-- 付いていないため、これまで気づかれずに動いていた)。
--
-- 実際にTelegramグループにABA画面を投稿してテストしたところ、
-- 「insert or update on table "expense_ocr_drafts" violates foreign key constraint
-- "expense_ocr_drafts_store_id_fkey"」で失敗することが判明したため修正する。
--
-- テーブルはまだ空 (0件) なので、既存データへの影響は無い。

alter table pos.expense_ocr_drafts
  drop constraint expense_ocr_drafts_store_id_fkey;

alter table pos.expense_ocr_drafts
  add constraint expense_ocr_drafts_store_id_fkey
  foreign key (store_id) references pos.stores(id);
