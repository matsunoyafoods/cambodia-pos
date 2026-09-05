-- キッチンモニターで数量2以上の品目を1個ずつ完了できるようにする (2026-09-05 追加。
-- Tomからの要望「Chicken Broccoli × 3 の3個のところを1個づつでも完了できて数量が減って
-- いくようにしたい」)。今までは order_items 1行 (= 品目1件。数量はまとめて1つの数値)
-- に対して kitchen_done_at が付くか付かないかの二択だったが、数量のうち何個が完了したかを
-- 別カラムで保持できるようにする。
--
-- 互換性: kitchen_done_at (NOT NULL = その品目は全数完了) の意味は変えない。
-- kitchen_done_qty が qty に達した時点で kitchen_done_at をセットする。レジ画面の
-- 提供完了トグル (pos-app.tsx toggleConfirmedItemServed)・会計画面の未提供バッジ判定・
-- 会計待ちステータス判定 (table-billing-status) は今まで通り kitchen_done_at の有無だけを
-- 見ているので、この変更による影響はない。
alter table pos.order_items
  add column kitchen_done_qty integer not null default 0;

-- 既存の「完了済み」行は数量分すべて完了済み扱いにしておく (バックフィル)。
update pos.order_items
set kitchen_done_qty = qty
where kitchen_done_at is not null;
