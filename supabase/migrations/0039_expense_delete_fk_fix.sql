-- 経費削除時の外部キーエラーを修正 (2026-10-15)。Tom「間違えた仕入れを削除しようとしたら
-- エラーになる」への対応。
--
-- pos.expense_ocr_drafts.confirmed_expense_id は「このOCR読み取りから実際に作られた
-- 経費はどれか」を指す履歴用の参照 (0032_expense_ocr_drafts.sql)。on delete 指定が
-- なかったため、その経費を削除しようとすると
-- "update or delete on table expenses violates foreign key constraint
--  expense_ocr_drafts_confirmed_expense_id_fkey" で失敗していた。
--
-- OCR読み取り履歴自体 (誰がいつ何を読み取って確認したか) は消す必要がないので、
-- ドラフト行は残したまま参照だけ null にする (on delete set null) 方針にする。
alter table pos.expense_ocr_drafts
  drop constraint expense_ocr_drafts_confirmed_expense_id_fkey;

alter table pos.expense_ocr_drafts
  add constraint expense_ocr_drafts_confirmed_expense_id_fkey
  foreign key (confirmed_expense_id) references pos.expenses(id) on delete set null;
