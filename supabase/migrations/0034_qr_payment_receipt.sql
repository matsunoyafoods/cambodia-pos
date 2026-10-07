-- QR + ABA PayWay 決済フロー Phase 1 (2026-10-06 追加)。
-- Tom「会計確定→QR表示→お客様のスマホでABA決済→自動でPAID」の実現に向けた土台。
-- 既存の open/paid/void の3状態の間に、QR決済待ちを表す awaiting_payment を追加する
-- (チェック制約の拡張のみなので既存行・既存コードへの影響はない)。
alter table pos.orders drop constraint if exists orders_status_check;
alter table pos.orders add constraint orders_status_check
  check (status in ('open', 'awaiting_payment', 'paid', 'void'));

-- お客様向け明細・レシート公開ページ (/receipt/{token}) の検索キー。生の注文IDをURLに
-- 出さない (Tom「推測困難なトークンを使った安全なURLを」への対応) ため、注文IDとは別の
-- ランダムトークンを持たせる。NULL可 (QR決済を使わない従来の会計では発行されない)。
alter table pos.orders add column if not exists receipt_token text;
alter table pos.orders add column if not exists receipt_token_created_at timestamptz;

create unique index if not exists orders_receipt_token_key
  on pos.orders (receipt_token)
  where receipt_token is not null;
