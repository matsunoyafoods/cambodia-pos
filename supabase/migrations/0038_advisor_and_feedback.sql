-- AI経営相談チャット + スタッフからのフィードバック報告 (2026-10-07 追加)。
-- Tom「この診断をもとにそのままAIとやり取りができる。AIは経営コンサルタントとして
-- 相談にのってくれるtalk機能。そして新しい機能のドックフーティング。スタッフが誤字を
-- 見つけたらドックフーティングでAIに送信して修繕する。」への対応。

-- AI経営相談チャット: 店舗ごとに1本の継続した会話履歴 (owner/manager共有、期間を区切らない)。
-- sub_manager は利用不可 (他の経営データ系機能と同じ権限線引き)。
create table if not exists pos.advisor_messages (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references pos.stores(id) on delete cascade,
  role        text not null check (role in ('user', 'assistant')),
  content     text not null,
  staff_name  text,
  created_at  timestamptz not null default now()
);
create index if not exists advisor_messages_store_date_idx on pos.advisor_messages(store_id, created_at asc);
alter table pos.advisor_messages enable row level security;

-- スタッフからのフィードバック報告 (誤字・不具合の気づきをその場で送れる「ドッグフーディング」)。
-- 全スタッフ (part_time含む) が送信可能。送信時に notifyFeedbackReport() 経由でTomへ
-- Telegram通知する (telegram-notify.ts)。アプリ内の一覧画面は今回作らない (Tom確認済み)。
create table if not exists pos.feedback_reports (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references pos.stores(id) on delete cascade,
  staff_id    uuid references pos.staff(id) on delete set null,
  staff_name  text not null,
  message     text not null,
  page_path   text,
  created_at  timestamptz not null default now()
);
create index if not exists feedback_reports_store_date_idx on pos.feedback_reports(store_id, created_at desc);
alter table pos.feedback_reports enable row level security;
