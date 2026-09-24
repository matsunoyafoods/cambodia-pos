-- 手入力売上 (2026-09-24 追加)。
-- Tom「オーダー・会計機能をしばらく使わない間、何月何日に現金売上と信計(カード/QR等)売上が
-- わかるようにしたい」への対応。pos.orders/pos.payments 由来の /api/sales-report は
-- オーダー機能停止中は常に0件になってしまうため、別テーブルで手入力の日次売上を記録する。
-- 支払い方法の内訳は Tom の実際の運用 (credit card / ABA QR / KB QR / PPCB QR / Delivery /
-- voucher) に合わせて固定カラムにした (店舗設定で自由に増減する要件ではないため)。

create table pos.manual_daily_sales (
  id                uuid primary key default gen_random_uuid(),
  store_id          uuid not null,
  date              date not null,
  cash_usd          numeric(10,2) not null default 0,
  credit_card_usd   numeric(10,2) not null default 0,
  aba_qr_usd        numeric(10,2) not null default 0,
  kb_qr_usd         numeric(10,2) not null default 0,
  ppcb_qr_usd       numeric(10,2) not null default 0,
  delivery_usd      numeric(10,2) not null default 0,
  voucher_usd       numeric(10,2) not null default 0,
  note              text,
  created_by        uuid references public.staff(id),
  created_by_name   text,
  updated_by        uuid references public.staff(id),
  updated_by_name   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (store_id, date)
);

alter table pos.manual_daily_sales enable row level security;
-- ポリシーは作らない (service_role のみアクセス可。他の pos.* テーブルと同じ方針)。
