-- 給与計算システム (2026-09-04追加)。Tomからの要望「スタッフごとの勤怠実績から給与
-- (基本給/アルバイト給与、遅刻・早退・欠勤控除、有給休暇、ガソリン代、寮費控除、最終支給額)
-- を月単位で自動計算できるようにしてほしい」に対応する。
--
-- 既存の pos.staff (PINログイン用スタッフマスタ) に給与情報を拡張し、既存の pos.timecards
-- (実打刻) とは別に、日次の予定/実際の勤怠・勤怠区分を管理する新しいテーブル群を追加する。
-- 既存の pos.timecards・pos.expenses 等と同様、pos.staff への外部キーは付けず (店舗を跨いだ
-- 誤参照を過去に複数回起こしているため。0015_timecards_staff_id_no_fk 等参照)、アプリ層
-- (API ルート) で store_id・staff_id の整合性を検証する方式に統一する。

-- ============ pos.staff の拡張 (給与情報) ============

alter table pos.staff add column employment_type text not null default 'employee'
  check (employment_type in ('employee', 'part_time'));
alter table pos.staff add column position_title text;
alter table pos.staff add column base_pay_usd numeric(10,2);
alter table pos.staff add column standard_daily_hours numeric(5,2) not null default 8.5;
alter table pos.staff add column monthly_holiday_days integer not null default 4;
alter table pos.staff add column paid_leave_eligible boolean not null default false;
alter table pos.staff add column paid_leave_annual_days numeric(5,2) not null default 0;
alter table pos.staff add column paid_leave_start_date date;
alter table pos.staff add column hire_date date;
alter table pos.staff add column resignation_date date;

comment on column pos.staff.employment_type is '雇用区分: employee=社員(固定給から控除方式) / part_time=アルバイト(実働時間分のみ支給)';
comment on column pos.staff.base_pay_usd is '社員は月額固定給、アルバイトは基準月額 (時間単価の算出根拠)';

-- ============ 固定手当・固定控除 (スタッフごと複数、適用期間付き) ============

create table pos.payroll_allowances (
  id           uuid primary key default gen_random_uuid(),
  store_id     uuid not null,
  staff_id     uuid not null,
  name         text not null,
  kind         text not null check (kind in ('allowance', 'deduction')),
  amount_usd   numeric(10,2) not null,
  start_date   date not null,
  end_date     date,
  monthly      boolean not null default true,
  note         text,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index payroll_allowances_staff_idx on pos.payroll_allowances (staff_id);

-- ============ 日次勤怠 (予定/実際の出退勤時刻・勤怠区分) ============
-- pos.timecards (実打刻) とは独立したテーブル。給与計算入力画面を開いた際、対象日の
-- pos.timecards の実打刻があれば actual_* 列の初期値として取り込む (取り込み後はこちら側で
-- 独立して編集・保存する。打刻の生記録自体は一切変更しない)。

create table pos.payroll_attendance_days (
  id                    uuid primary key default gen_random_uuid(),
  store_id              uuid not null,
  staff_id              uuid not null,
  work_date             date not null,
  category              text not null default 'normal' check (category in (
    'normal', 'scheduled_off', 'paid_leave', 'unpaid_absence', 'late', 'early_leave',
    'half_day', 'am_only', 'pm_only', 'other'
  )),
  scheduled_am_start    time,
  scheduled_am_end      time,
  actual_am_start       time,
  actual_am_end         time,
  scheduled_pm_start    time,
  scheduled_pm_end      time,
  actual_pm_start       time,
  actual_pm_end         time,
  late_minutes          integer not null default 0,      -- 端数処理後 (15分単位切り上げ)
  early_leave_minutes   integer not null default 0,       -- 端数処理後
  worked_hours          numeric(5,2) not null default 0,  -- アルバイトの実働時間 (自動計算 or 手動上書き)
  manual_override       boolean not null default false,
  override_reason       text,
  note                  text,
  source                text not null default 'manual' check (source in ('manual', 'timecard_import')),
  edited_by             uuid,
  edited_at             timestamptz,
  created_at            timestamptz not null default now(),
  unique (staff_id, work_date)
);
create index payroll_attendance_days_staff_month_idx on pos.payroll_attendance_days (staff_id, work_date);

-- 日次勤怠の修正履歴 (確定前の通常編集も含めて全件記録。Tom要望「手動で実労働時間を修正できる
-- 機能。修正理由と変更履歴を保存」)
create table pos.payroll_attendance_day_history (
  id                  uuid primary key default gen_random_uuid(),
  attendance_day_id   uuid not null references pos.payroll_attendance_days(id) on delete cascade,
  before_json         jsonb,
  after_json          jsonb not null,
  reason              text,
  changed_by          uuid,
  changed_at          timestamptz not null default now()
);

-- ============ 有給休暇台帳 (付与・使用・失効・調整を1行ずつ記録、残日数は都度集計) ============

create table pos.payroll_leave_ledger (
  id                        uuid primary key default gen_random_uuid(),
  store_id                  uuid not null,
  staff_id                  uuid not null,
  entry_type                text not null check (entry_type in ('grant', 'use', 'expire', 'adjustment')),
  entry_date                date not null,
  days                      numeric(5,2) not null,   -- grant/adjustment(+) は正、use/expire は負で記録
  fiscal_year_start_year    integer not null,          -- 例: 2026 = 2026-04-01〜2027-03-31 年度
  note                      text,
  created_by                uuid,
  created_at                timestamptz not null default now()
);
create index payroll_leave_ledger_staff_idx on pos.payroll_leave_ledger (staff_id, fiscal_year_start_year);

-- ============ 月次給与 (スタッフ×年月、ステータス管理) ============

create table pos.payroll_runs (
  id             uuid primary key default gen_random_uuid(),
  store_id       uuid not null,
  staff_id       uuid not null,
  year_month     text not null,   -- 'YYYY-MM'
  status         text not null default 'draft' check (status in ('draft', 'pending_review', 'confirmed')),
  calc_json      jsonb not null,  -- 計算結果一式のスナップショット (使用した単価・内訳を含む)
  confirmed_by   uuid,
  confirmed_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (staff_id, year_month)
);
create index payroll_runs_store_month_idx on pos.payroll_runs (store_id, year_month);

-- 確定後の修正履歴 (Tom要望「確定後に修正する場合は変更前後の内容・日時・ユーザー・理由を記録」)
create table pos.payroll_run_amendments (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references pos.payroll_runs(id) on delete cascade,
  before_json   jsonb not null,
  after_json    jsonb not null,
  reason        text not null,
  changed_by    uuid,
  changed_at    timestamptz not null default now()
);

-- ============ RLS (他の pos ネイティブテーブルと同様、service_role 経由の API ルートからのみ) ============

alter table pos.payroll_allowances enable row level security;
alter table pos.payroll_attendance_days enable row level security;
alter table pos.payroll_attendance_day_history enable row level security;
alter table pos.payroll_leave_ledger enable row level security;
alter table pos.payroll_runs enable row level security;
alter table pos.payroll_run_amendments enable row level security;
-- 許可ポリシーは作らない (withPosStaff を通した service_role 経由の API ルートからのみアクセスする)。
