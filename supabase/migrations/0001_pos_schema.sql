-- Cambodia POS: pos スキーマ + menu_items オプション拡張
-- 元ネタ: matsunoya-dine/docs/integration-spec.md 3.4 詳細スキーマ定義 (DDL 草案)
-- 適用先: matsunoya-dine と共有の Supabase プロジェクト (別スキーマ方式)
--
-- 2026-08-29 修正: 実スキーマ調査の結果、以下のとおり FK 参照先を修正
--   public.menus        -> public.menu_items
--   public.staff         -> public.users (store_members.role で権限判定)
--   public.customers    -> public.users
--   store_id (無制約)    -> public.stores(id) を参照

create schema if not exists pos;
create extension if not exists pgcrypto;

-- ============ public (Master, matsunoya-dine 管理画面が編集元) ============
-- public.menu_items は matsunoya-dine 側の既存マイグレーションで作成済みの前提。
-- ここでは商品オプション（グラム数・セット選択など）の子テーブルのみ追加する。

create table public.menu_option_groups (
  id           uuid primary key default gen_random_uuid(),
  menu_id      uuid not null references public.menu_items(id) on delete cascade,
  key          text not null,             -- 例: 'weight', 'side'
  label        text not null,             -- 例: '量目を選択'
  required     boolean not null default true,
  sort_order   integer not null default 0,
  unique (menu_id, key)
);

create table public.menu_option_choices (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references public.menu_option_groups(id) on delete cascade,
  choice_key    text not null,            -- 例: '100g'
  label         text not null,            -- 例: '100g'
  price_delta   numeric(10,2) not null default 0,
  sort_order    integer not null default 0,
  unique (group_id, choice_key)
);

-- ============ pos (POS 専用) ============

create table pos.settings (
  id             uuid primary key default gen_random_uuid(),
  store_id       uuid not null references public.stores(id),
  vat_rate       numeric(5,2) not null default 10.00,
  service_rate   numeric(5,2) not null default 10.00,
  khr_rate       integer not null default 4100,   -- 1 USD = ? KHR
  cash_enabled   boolean not null default true,
  qr_enabled     boolean not null default true,
  card_enabled   boolean not null default true,
  updated_by     uuid references public.users(id),
  updated_at     timestamptz not null default now(),
  unique (store_id)
);

create table pos.orders (
  id               uuid primary key default gen_random_uuid(),
  store_id         uuid not null references public.stores(id),
  table_code       text,
  customer_id      uuid references public.users(id),
  status           text not null default 'open' check (status in ('open','paid','void')),
  subtotal         numeric(10,2) not null,
  vat              numeric(10,2) not null,
  service          numeric(10,2) not null,
  coupon_id        uuid references public.coupons(id),
  coupon_discount  numeric(10,2) not null default 0,
  total            numeric(10,2) not null,
  source           text not null default 'pos' check (source in ('pos','grab')),
  created_by       uuid references public.users(id),
  created_at       timestamptz not null default now(),
  paid_at          timestamptz
);

create table pos.order_items (
  id                   uuid primary key default gen_random_uuid(),
  order_id             uuid not null references pos.orders(id) on delete cascade,
  menu_id              uuid not null references public.menu_items(id),
  menu_name            text not null,          -- 注文時点の名称スナップショット
  qty                  integer not null check (qty > 0),
  unit_price           numeric(10,2) not null, -- 基準価格 + 選択オプションの price_delta 合計
  selected_options     jsonb not null default '[]',
    -- [{ "group_key": "weight", "group_label": "量目を選択", "choice_id": "200g", "choice_label": "200g", "price_delta": 16.00 }]
  line_total           numeric(10,2) not null,
  sent_to_kitchen_at   timestamptz
);

create table pos.payments (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references pos.orders(id) on delete cascade,
  method              text not null check (method in ('cash','qr','card')),
  amount              numeric(10,2) not null,
  cash_received_usd   numeric(10,2),
  cash_received_khr   integer,
  change_usd          numeric(10,2),
  change_khr          integer,
  confirmed_by        uuid references public.users(id),
  confirmed_at        timestamptz not null default now()
);

create table pos.receipts (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references pos.orders(id),
  kind           text not null check (kind in ('store_copy','customer_copy')),
  printed_at     timestamptz not null default now(),
  reprint_count  integer not null default 0
);

create table pos.expenses (
  id                uuid primary key default gen_random_uuid(),
  store_id          uuid not null references public.stores(id),
  date              date not null,
  amount_usd        numeric(10,2) not null,
  category          text not null,
  note              text,
  receipt_image_url text,
  created_by        uuid references public.users(id),
  created_at        timestamptz not null default now()
);

create table pos.register_closings (
  id                   uuid primary key default gen_random_uuid(),
  store_id             uuid not null references public.stores(id),
  date                 date not null,
  shift                text,               -- 例: '夜の部' (任意)
  system_cash_total    numeric(10,2) not null,
  system_qr_total      numeric(10,2) not null,
  system_card_total    numeric(10,2) not null,
  counted_usd_bills    jsonb not null,      -- {"100":2,"50":1,...}
  counted_khr_bills    jsonb not null,      -- {"100000":3,...}
  counted_total_usd    numeric(10,2) not null,
  difference_usd       numeric(10,2) not null,
  confirmed_by         uuid references public.users(id),
  confirmed_at         timestamptz not null default now()
);

create table pos.table_layouts (
  id           uuid primary key default gen_random_uuid(),
  store_id     uuid not null references public.stores(id),
  table_code   text not null,
  label        text,
  area         text,                 -- フロア/テラス/個室/カウンター/Takeaway
  x            integer not null default 0,
  y            integer not null default 0,
  width        integer not null default 84,
  height       integer not null default 64,
  seats        integer not null default 4,
  sort_order   integer not null default 0,
  updated_at   timestamptz not null default now(),
  unique (store_id, table_code)
);

create table pos.delivery_orders (
  id                 uuid primary key default gen_random_uuid(),
  store_id           uuid not null references public.stores(id),
  provider           text not null default 'grab',
  provider_order_id  text not null,
  status             text not null default 'received'
    check (status in ('received','accepted','preparing','ready','picked_up','cancelled')),
  payload            jsonb not null,        -- Webhook の生データ
  pos_order_id       uuid references pos.orders(id),
  received_at        timestamptz not null default now(),
  unique (provider, provider_order_id)
);

-- Phase 1.5
create table pos.timecards (
  id          uuid primary key default gen_random_uuid(),
  staff_id    uuid not null references public.users(id),
  clock_in    timestamptz not null,
  clock_out   timestamptz,
  note        text
);

-- ============ RLS (integration-spec.md 3.3) ============
-- 権限判定は public.store_members.role ('owner' | 'manager' | 'staff') を利用する。
alter table pos.settings enable row level security;
alter table pos.orders enable row level security;
alter table pos.order_items enable row level security;
alter table pos.payments enable row level security;
alter table pos.receipts enable row level security;
alter table pos.expenses enable row level security;
alter table pos.register_closings enable row level security;
alter table pos.table_layouts enable row level security;
alter table pos.delivery_orders enable row level security;
alter table pos.timecards enable row level security;
alter table public.menu_option_groups enable row level security;
alter table public.menu_option_choices enable row level security;

-- pos.settings: そのストアの store_members であれば read 可、write はオーナー/マネージャーのみ
create policy "pos_settings_read_members" on pos.settings
  for select using (
    exists (
      select 1 from public.store_members sm
      where sm.store_id = pos.settings.store_id
        and sm.user_id = auth.uid()
    )
  );

create policy "pos_settings_write_manager" on pos.settings
  for all using (
    exists (
      select 1 from public.store_members sm
      where sm.store_id = pos.settings.store_id
        and sm.user_id = auth.uid()
        and sm.role in ('owner', 'manager')
    )
  );
