-- 会計取消 (2026-09-20 追加)。Tom「会計を間違えて後から訂正する時はそうなりますか？」
-- → 現状は会計完了 (status='paid') 後に取消・修正する手段が無いことが判明したため新設。
--
-- 「取消」は該当の pos.orders を status='void' にする (table-reset/table-merge で使っている
-- 既存の 'void' ステータスと同じ意味 = 「この伝票は売上に数えない」)。status='paid' でのみ
-- 絞り込んでいる sales-report・register-closings・cash-balance の集計から自動的に除外される
-- ため、それらのクエリ側の変更は不要。
--
-- Tom「履歴を編集した場合履歴が残るようにしてください」への対応で、取消の都度
-- 取消前の内容 (金額・会計内訳・支払い明細) を snapshot として pos.order_void_log に保存し、
-- 誰が・いつ・なぜ取消したかを記録する。取消後、店舗側は同じ卓で通常通り新しい会計をやり直す
-- 運用を想定 (取消した伝票を「未会計」に戻して再編集させる方式は、その卓が既に別の来店で
-- 新しい open 注文を持っている場合に「1卓1open注文」の前提が崩れる恐れがあるため採用しない)。

create table if not exists pos.order_void_log (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references pos.orders(id) on delete cascade,
  store_id        uuid not null references pos.stores(id) on delete cascade,
  table_code      text,
  reason          text,
  snapshot        jsonb not null,   -- 取消前の内容 (subtotal/vat/service/discount/total/payments/items)
  voided_by       uuid references pos.staff(id),
  voided_by_name  text,
  voided_at       timestamptz not null default now()
);

create index if not exists order_void_log_order_id_idx on pos.order_void_log(order_id);
create index if not exists order_void_log_store_date_idx on pos.order_void_log(store_id, voided_at desc);

alter table pos.order_void_log enable row level security;
