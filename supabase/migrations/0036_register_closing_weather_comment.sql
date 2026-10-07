-- レジ締めへの天候・コメント欄追加 (2026-10-07 追加)。Tom「レジ締めする時にコメント欄と
-- ランチとディナーで天気を選択できるようにしてください。それがテレグラムのレポートに
-- 反映して」への対応。
--
-- weather: 時間帯 (pos.stores.settings.timePeriods の id。デフォルトは 'lunch'/'dinner') ごとの
--   天候コード ('sunny'|'cloudy'|'rainy'|'stormy'、src/lib/pos-types.ts の WEATHER_CODES) を
--   持つ jsonb オブジェクト (例: {"lunch":"sunny","dinner":"rainy"})。未選択の時間帯は
--   キーごと省略する。
-- comment: その日のレジ締め全体に対する自由入力コメント。
alter table pos.register_closings add column if not exists weather jsonb not null default '{}'::jsonb;
alter table pos.register_closings add column if not exists comment text;
