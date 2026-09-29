-- 2026-09-29: TelegramグループのABA送金確認画面をBotが自動で読み取り、POSレジの経費に
-- 登録する機能のための一時テーブル (Tom「TelegramグループのABA支払い完了画面をBotが読み取って
-- POSレジに自動で入力されているようにしたい」への対応)。
--
-- Bot が写真を読み取った直後にここへ pending で1行作り、Telegram上のボタン確認 (✅登録/
-- ❌無視) を経て status を confirmed/rejected に更新する。confirmed になった時点で初めて
-- 実際の pos.expenses に1行作る (OCRの誤読がそのまま経費として記録されるのを防ぐため、
-- Tomの希望で「確認してから登録」方式にした)。
--
-- Telegramのやり取りから来るデータなので POS スタッフのブラウザセッションではなく、
-- 共有シークレット (TELEGRAM_BRIDGE_SECRET) で認証する専用エンドポイント
-- (/api/bridge/telegram-expense-ocr) からのみ読み書きする。アプリの画面からは今のところ
-- 参照しない (RLS は有効化するがポリシーは作らない = service_role 経由のみアクセス可能、
-- 0031 で学んだ方針を踏襲)。

create table pos.expense_ocr_drafts (
  id                    uuid primary key default gen_random_uuid(),
  store_id              uuid not null references public.stores(id),
  status                text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
  telegram_chat_id      text not null,
  telegram_message_id   text not null,
  amount_guess          numeric(10, 2),
  vendor_guess          text,
  category_guess        text,
  date_guess            date,
  confirmed_expense_id  uuid references pos.expenses(id),
  confirmed_by_telegram text,
  confirmed_at          timestamptz,
  created_at            timestamptz not null default now()
);

create index expense_ocr_drafts_store_status_idx on pos.expense_ocr_drafts (store_id, status);

alter table pos.expense_ocr_drafts enable row level security;
