-- 予約の卓割り当て (2026-09-02 追加)。
-- Tom「予約からどこの席を何時から使うという設定ができて、設定した席に予約マークがついて
-- 何時から予約かが分かるようにしてほしい」への対応。
--
-- 予約には2種類のソースがある: POS電話予約 (pos.reservations、id はそのまま uuid) と
-- matsunoya-dine アプリ予約 (public.reservations、一覧APIでは 'app:<dine予約id>' という
-- 仮想IDで読み取り専用マージ表示している)。アプリ予約は pos.reservations に行が無いため、
-- pos.reservations に table_codes カラムを足すだけでは対応できない。
-- そこで reservation_ref (text。POS予約なら自身の id、アプリ予約なら 'app:...') をキーにした
-- 別テーブルで両ソースを統一的に扱う。時刻 (何時から) は既存の reservation_date/reservation_time
-- (pos.reservations 側) / reserved_at (dine側) をそのまま使うので、ここでは卓の割り当てのみ持つ。
create table pos.reservation_table_assignments (
  id                uuid primary key default gen_random_uuid(),
  store_id          uuid not null references pos.stores(id) on delete cascade,
  reservation_ref   text not null,
  table_codes       text[] not null default '{}',
  updated_by_name   text,
  updated_at        timestamptz not null default now(),
  unique (store_id, reservation_ref)
);

create index reservation_table_assignments_store_idx on pos.reservation_table_assignments (store_id);

alter table pos.reservation_table_assignments enable row level security;
-- 他の pos ネイティブテーブルと同様、許可ポリシーは作らない (withPosStaff を通した
-- service_role 経由の API ルートからのみアクセスする)。
