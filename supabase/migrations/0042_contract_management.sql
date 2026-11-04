-- 契約店舗管理 (D-簡易の店舗ごとの契約・トライアル・機能課金カタログ) のための拡張。
-- Tom「契約店舗管理画面を作らないといけないですね！そこからメールを送信して初期パスワード
-- 設定をできるようにしましょう。機能は契約店舗管理画面で設定できるようにしましょう。
-- 店舗側は追加機能の詳細をみると月額値段がわかるようにしましょう。1ヶ月間はお試しで1ヶ月
-- できるようにも設定したいです。5日前などに無料期間が切れるアラートをだしてください。
-- 僕のテレグラムにもその情報が来るようにしたいです。」への対応。
-- 契約店舗管理画面自体は新しい別アプリ (cambodia-pos-admin) として実装する
-- (multi-tenant-productization-addendum-2026-11.md 追記分、2026-11-04 Tom確認済み)。
-- 新しい別アプリは本テーブル群に service_role で直接アクセスする。

-- ============ pos.stores への契約・トライアル情報の追加 ============

alter table pos.stores
  add column contact_email text,
  add column contact_name text,
  add column contract_status text not null default 'trial'
    check (contract_status in ('trial', 'active', 'suspended', 'cancelled', 'expired')),
  add column trial_ends_at timestamptz,
  add column trial_alert_sent_at timestamptz,
  add column base_price_usd numeric(10,2),
  add column contract_notes text;

comment on column pos.stores.contract_status is
  'trial=お試し中, active=契約確定, suspended=一時停止 (Tomが手動), cancelled=解約, expired=トライアル期限切れ(機能自動OFF済み)';
comment on column pos.stores.trial_ends_at is
  '無料期間の終了日時。nullならトライアル期間の管理対象外 (既存の松之屋フーズ等)。';
comment on column pos.stores.trial_alert_sent_at is
  '「残り5日」Telegramアラートを送信済みの時刻 (多重送信防止の重複排除用)。';

-- 既存店舗 (松之屋フーズ) は手動で 'active' に更新する (本マイグレーションでは一律 'trial' に
-- なるが、デフォルト値は新規行向けの初期値であり、既存行は後述の要対応手順で更新する)。

-- ============ 機能カタログ (全店舗共通の価格表。契約店舗管理画面から編集する想定) ============

create table pos.feature_catalog (
  feature_key        text primary key check (feature_key in (
    'reservations', 'handy', 'kitchen', 'drinks', 'qrCodes', 'expenses', 'timecard',
    'insights', 'advisor', 'salesReport', 'salesEntry', 'registerClosing', 'payroll'
  )),
  monthly_price_usd  numeric(10,2) not null default 0,
  sort_order         integer not null default 0,
  updated_at         timestamptz not null default now()
);

comment on table pos.feature_catalog is
  '機能ごとの月額価格 (全店舗共通、店舗ごとの個別価格は現状未対応)。表示名・説明は
   src/lib/i18n/dictionary.ts の settings.features.* キーを再利用するためここには持たない。
   契約店舗管理画面 (cambodia-pos-admin) から価格を編集する。各店舗で実際に有効/無効にする
   かどうかは既存の pos.stores.settings.enabledFeatures (jsonb) のまま変更していない。';

insert into pos.feature_catalog (feature_key, sort_order) values
  ('reservations', 1),
  ('handy', 2),
  ('kitchen', 3),
  ('drinks', 4),
  ('qrCodes', 5),
  ('expenses', 6),
  ('timecard', 7),
  ('insights', 8),
  ('advisor', 9),
  ('salesReport', 10),
  ('salesEntry', 11),
  ('registerClosing', 12),
  ('payroll', 13);

-- ============ 新規店舗オーナーの初回PIN設定用トークン ============

create table pos.owner_setup_tokens (
  id             uuid primary key default gen_random_uuid(),
  store_id       uuid not null references pos.stores(id) on delete cascade,
  token          text not null unique,
  contact_email  text not null,
  contact_name   text,
  expires_at     timestamptz not null,
  used_at        timestamptz,
  created_at     timestamptz not null default now()
);

create index owner_setup_tokens_store_id_idx on pos.owner_setup_tokens (store_id);

comment on table pos.owner_setup_tokens is
  '契約店舗管理画面 (cambodia-pos-admin) がメール送信時に発行する、新規店舗オーナーの
   初回POS PIN設定用の使い捨てトークン。対象店舗自身のデプロイ (cambodia-pos) の
   /owner-setup/[token] ページ・API が検証・消費する。他の pos ネイティブテーブルと同じく
   RLSは有効化のみで許可ポリシーは作らない (service_role 経由のみ)。';

alter table pos.feature_catalog enable row level security;
alter table pos.owner_setup_tokens enable row level security;
