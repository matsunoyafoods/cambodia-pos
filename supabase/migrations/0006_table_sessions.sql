-- Cambodia POS: 卓ごとの滞在タイマー・飲み放題タイマー用テーブル
-- 「注文商品を入力すると同時に滞在時間タイマーが発動」「飲み放題メニューを注文すると
-- 飲み放題タイマーが発動」という要望に対応するため、卓単位の「現在の来店セッション」を
-- 1行だけ保持する。会計完了 (またはスタッフによるリセット) で行を削除し、次の来店に備える。
--
-- 既存テーブルへの変更は無いので、松之屋フーズの現行動作に影響しない。

create table pos.table_sessions (
  id                       uuid primary key default gen_random_uuid(),
  store_id                 uuid not null references pos.stores(id) on delete cascade,
  table_code               text not null,
  started_at               timestamptz not null default now(),   -- 滞在タイマーの起点 (最初の注文品目を入力した時刻)
  drink_timer_started_at   timestamptz,                           -- 飲み放題タイマーの起点 (null = 未注文)
  drink_timer_minutes      integer not null default 0,            -- 飲み放題の合計時間(分)。延長ごとに加算
  updated_at               timestamptz not null default now(),
  unique (store_id, table_code)
);

alter table pos.table_sessions enable row level security;
-- 他の pos ネイティブテーブルと同様、許可ポリシーは作らない (service_role 経由の
-- 公開 API ルートからのみアクセスする。multi-tenant-productization-spec.md §3.4)。
