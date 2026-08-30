-- Cambodia POS: 予約受付機能
-- 電話等で予約を受ける際、スタッフが画面の質問(声かけ文言つき)に沿って
-- 順番に聞きながら入力できるようにするための保存先。
-- 通常予約・誕生日テンダーロインブロック予約・個室予約・団体予約の4種を
-- reservation_type で区別し、種別ごとに異なる追加情報は details (jsonb) に持たせる
-- (pos.stores.settings / pos.order_items.selected_options と同じ設計方針)。

create table pos.reservations (
  id                  uuid primary key default gen_random_uuid(),
  store_id            uuid not null references pos.stores(id) on delete cascade,
  reservation_type    text not null check (reservation_type in ('normal', 'tenderloin_block', 'birthday_room', 'group')),
  customer_name       text not null,
  phone               text,
  party_size          integer,
  reservation_date    date not null,
  reservation_time    text,             -- 'HH:MM' 形式の文字列で保持 (時間未定の予約も許容するため time 型にしない)
  details             jsonb not null default '{}',
    -- tenderloin_block: { "cut": "AU"|"US", "weight": "1000g"|"1500g" }
    -- birthday_room:    { "occasion": "...", "decoration_request": "..." }
    -- group:            { "budget_per_person": 20, "purpose": "..." }
    -- normal:           { "seating_request": "..." }
  notes               text,
  status              text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  created_by_name     text,             -- スタッフ表示名のスナップショット (dine連携/POS PINどちらのログインでも記録できるように)
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index reservations_store_date_idx on pos.reservations (store_id, reservation_date);

alter table pos.reservations enable row level security;
-- 他の pos ネイティブテーブルと同様、許可ポリシーは作らない (withPosStaff を通した
-- service_role 経由の API ルートからのみアクセスする)。
