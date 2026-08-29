-- Cambodia POS: POS単体運用のためのネイティブ「core」テーブル追加
-- 元ネタ: docs/multi-tenant-productization-spec.md Phase A
--
-- 目的: POS を matsunoya-dine (public schema) に依存せずに単体運用できるようにする。
-- 松之屋フーズの現行運用 (matsunoya-dine 連携モード) には一切影響しない
-- (新規テーブルは空のまま、既存テーブル・既存カラムは変更しない)。
--
-- テナント分離方式: 単一 Supabase プロジェクト内で pos.stores.id をテナントIDとして
-- 行レベル分離する (multi-tenant-productization-spec.md §4-1 で確定)。
--
-- 認可方式: pos.staff の PIN ログインは Supabase Auth セッションを発行しないため、
-- 本マイグレーションで作成する POS ネイティブテーブルは RLS を有効化した上で
-- anon/authenticated ロール向けの許可ポリシーを一切作らない (デフォルト拒否)。
-- アクセスは Next.js API Route から service_role 経由でのみ行い、認可判定
-- (store_id・role の検証) は API Route 側の helper (仮称 withPosStaff) で行う。
-- (multi-tenant-productization-spec.md §3.4)

-- ============ POS ネイティブ店舗・スタッフ ============

create table pos.stores (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  timezone     text not null default 'Asia/Phnom_Penh',
  settings     jsonb not null default '{}',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table pos.staff (
  id             uuid primary key default gen_random_uuid(),
  store_id       uuid not null references pos.stores(id) on delete cascade,
  display_name   text not null,
  role           text not null default 'staff' check (role in ('owner', 'manager', 'staff')),
  pin_hash       text not null,           -- PIN は平文で保存しない (bcrypt等でハッシュ化)
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (store_id, display_name)
);

-- ============ POS ネイティブメニューマスタ ============

create table pos.menu_categories (
  id           uuid primary key default gen_random_uuid(),
  store_id     uuid not null references pos.stores(id) on delete cascade,
  name         text not null,
  sort_order   integer not null default 0,
  unique (store_id, name)
);

create table pos.menu_items (
  id           uuid primary key default gen_random_uuid(),
  store_id     uuid not null references pos.stores(id) on delete cascade,
  category_id  uuid references pos.menu_categories(id) on delete set null,
  name         text not null,
  price        numeric(10,2) not null,   -- USD (matsunoya-dine 側は cents 単位だが POS ネイティブは dollars で統一)
  active       boolean not null default true,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table pos.menu_option_groups (
  id           uuid primary key default gen_random_uuid(),
  menu_id      uuid not null references pos.menu_items(id) on delete cascade,
  key          text not null,
  label        text not null,
  required     boolean not null default true,
  sort_order   integer not null default 0,
  unique (menu_id, key)
);

create table pos.menu_option_choices (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references pos.menu_option_groups(id) on delete cascade,
  choice_key    text not null,
  label         text not null,
  price_delta   numeric(10,2) not null default 0,
  sort_order    integer not null default 0,
  unique (group_id, choice_key)
);

-- ============ matsunoya-dine との連携設定 (オプトイン) ============

create table pos.integrations (
  id                      uuid primary key default gen_random_uuid(),
  store_id                uuid not null references pos.stores(id) on delete cascade,
  dine_store_id           uuid,                     -- matsunoya-dine 側 public.stores.id (別プロジェクトの可能性もあるため FK は張らない)
  dine_api_base_url       text,
  dine_api_key_ciphertext text,                      -- Vercel env 等での管理を基本とし、DB保存する場合は暗号化必須
  menu_source             text not null default 'pos_native'
    check (menu_source in ('pos_native', 'dine_live', 'dine_synced')),
  customer_link_enabled   boolean not null default false,
  last_synced_at          timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (store_id)
);

-- ============ RLS: 全テーブルで有効化するが、許可ポリシーは一切作らない (デフォルト拒否) ============
-- service_role のみがアクセス可能。anon/authenticated からの直接アクセスは常に拒否される。

alter table pos.stores enable row level security;
alter table pos.staff enable row level security;
alter table pos.menu_categories enable row level security;
alter table pos.menu_items enable row level security;
alter table pos.menu_option_groups enable row level security;
alter table pos.menu_option_choices enable row level security;
alter table pos.integrations enable row level security;
