-- 現金残高管理 (2026-09-02 追加)。
-- Tom「レジの中に現金売上が貯まります。現金売上を銀行入金します。現金売上残高がいくらあるか
-- 分かるようにしたいです。なのでレジ締めの時の現金売上が貯まるようにして、経費のところに銀行入金欄を
-- 追加してください。経費のところで売上現金残高がわかるようにしてください。」への対応。
--
-- 現金残高 = Σ(確定したレジ締めの現金売上) − Σ(銀行入金) − Σ(レジの現金で払った経費、支払い済みのみ)
-- (Tom確認: 現金払いの経費も残高から引く)

-- ---------- 1. 経費テーブルの外部キー修正 ----------
-- pos.expenses.store_id / created_by は Phase A の名残りで public.stores / public.users を
-- 参照したままだった。松之屋フーズは pos_native 運用 (POS_STORE_ID は pos.stores 側の id、
-- created_by は pos.staff.id) のため、このFKが残っている限り経費の登録は必ず外部キー違反で
-- 失敗する (実際、本番テーブルは0件だった = このバグにより一度も経費登録が成功していなかった)。
-- pos.orders.created_by 等で既に確立している「外部キー無し・アプリ層で管理」方式に合わせる。
alter table pos.expenses drop constraint if exists expenses_store_id_fkey;
alter table pos.expenses drop constraint if exists expenses_created_by_fkey;

-- ---------- 2. レジ締めテーブルの外部キー修正・拡張 ----------
-- 同じ理由 (register_closings も Phase A の名残りで public.* を参照しており、これまで一度も
-- 実データを書き込んだことが無かった = 今回初めて実データ連携する)。
alter table pos.register_closings drop constraint if exists register_closings_store_id_fkey;
alter table pos.register_closings drop constraint if exists register_closings_confirmed_by_fkey;

-- 決済方法が店舗ごとに自由に追加できる汎用リスト方式になった (2026-08-31, §0.1a) のに合わせ、
-- 旧来の固定2列 (QR/カード) は使わず、決済方法名ごとの内訳を jsonb で持つ。
alter table pos.register_closings alter column system_qr_total drop not null;
alter table pos.register_closings alter column system_card_total drop not null;
alter table pos.register_closings add column if not exists system_totals_by_method jsonb not null default '{}';
alter table pos.register_closings add column if not exists confirmed_by_name text;

-- 1日1回のレジ締めを前提にする (シフトごとの複数回締めは今回のスコープ外)。
alter table pos.register_closings add constraint register_closings_store_date_unique unique (store_id, date);

-- ---------- 3. 経費: 支払い元 (レジの現金 / その他) ----------
-- レジの現金で立て替え・支払いした経費は、現金残高から自動で差し引く (Tom確認済み)。
alter table pos.expenses add column if not exists paid_from text not null default 'other' check (paid_from in ('register_cash', 'other'));

-- ---------- 4. 銀行入金記録 (新規) ----------
create table if not exists pos.cash_deposits (
  id                uuid primary key default gen_random_uuid(),
  store_id          uuid not null references pos.stores(id) on delete cascade,
  date              date not null,
  amount_usd        numeric not null check (amount_usd > 0),
  note              text,
  created_by_name   text,
  created_at        timestamptz not null default now()
);

create index if not exists cash_deposits_store_date_idx on pos.cash_deposits (store_id, date);

alter table pos.cash_deposits enable row level security;
-- 他の pos ネイティブテーブルと同様、許可ポリシーは作らない (withPosStaff 経由の service_role のみ)。
