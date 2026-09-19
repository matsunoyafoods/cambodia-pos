-- レジ金 (開店時にレジへ入れておく釣銭用の基準額) のスナップショット保存 (2026-09-19 追加)。
--
-- Tom「最初に入ってるレジ金設定がないからレジ締めの時にお金が合わない」への対応。
-- レジ金の設定値自体は pos.stores.settings (jsonb) の registerFloatUsd に保存する
-- (新規マイグレーション不要、既存の vatRate/khrRate 等と同じ仕組み)。
-- 一方、レジ締め (pos.register_closings) は確定時点の値をスナップショットとして残す必要がある
-- (後で設定を変更しても、過去のレジ締め記録の差額計算根拠が変わってしまわないように)。

alter table pos.register_closings add column if not exists register_float_usd numeric(10,2) not null default 0;
