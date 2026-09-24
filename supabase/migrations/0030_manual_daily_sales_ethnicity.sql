-- 手入力売上に客層(人種)を追加 (2026-09-24 追加)。
-- Tom「人種も入力できるようにしてください」への対応。/pos/sales-report のテーブル別詳細
-- (ethnicity: GuestEthnicity) と同じ構造 (jsonb: {"khmer": 3, "japanese": 2, ...}) を
-- その日の合計人数として保持する (手入力売上は1日1行のため、テーブル単位ではなく日単位の集計)。

alter table pos.manual_daily_sales
  add column ethnicity jsonb not null default '{}'::jsonb;
