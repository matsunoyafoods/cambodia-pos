-- 3階層カテゴリ (大→中→小) 対応: 自己参照の parent_id を追加。
-- 既存カテゴリ (全19件) は parent_id が null のまま = 引き続き「大カテゴリー」としてレジ画面の
-- タブに表示される (挙動は変わらない)。中・小カテゴリーは今後、設定画面から追加していく運用。
-- 削除時は ON DELETE SET NULL: 中カテゴリーを消しても、その下の小カテゴリーは大カテゴリー直下に
-- 昇格するだけで消えない (商品を巻き込んで消さないため)。
alter table pos.menu_categories add column if not exists parent_id uuid references pos.menu_categories(id) on delete set null;

-- 卓の来店ごとの伝票 (pos.orders) に客層記録用の列を追加。
-- ファースト注文確定時 (レジ画面で最初の商品をタップした時) に人種構成・子供人数を記録する。
-- pos.orders は会計完了後も削除されない (pos.table_sessions と違い) ため、来店ごとのデータとして残る。
-- guest_recorded_by は dine連携ログイン (public.users.id) / POSネイティブPINログイン (pos.staff.id)
-- のどちらの id も入り得るため、外部キー制約は付けない (アプリ層で管理)。
alter table pos.orders add column if not exists guest_ethnicity jsonb not null default '{}'::jsonb;
alter table pos.orders add column if not exists guest_kids_count integer not null default 0;
alter table pos.orders add column if not exists guest_recorded_by uuid;
alter table pos.orders add column if not exists guest_recorded_at timestamptz;
