-- 決済方法の遡及修正 + 監査ログ (2026-10-17 追加)。
--
-- Tom「すべてキャッシュになっています。これを遡ってスタッフが支払い方法を編集できますか？」
-- への対応。原因は「紙レシートでもらう」ボタンが選択中の決済方法を無視して常に現金で
-- 記録していた設計バグ (pos-app.tsx payWithPaperReceipt で別途修正)。既に記録されてしまった
-- 過去の会計の決済方法を、売上レポート画面 (/pos/sales-report) から manager以上が
-- 修正できるようにする。order_void_log と同じ考え方で、誰が・いつ・何から何に変えたかを
-- 残す監査ログを別テーブルに持つ (payments テーブル自体は上書きする)。
create table pos.payment_method_edit_log (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid not null references pos.stores(id),
  order_id      uuid not null references pos.orders(id),
  payment_id    uuid not null,
  old_method    text not null,
  new_method    text not null,
  edited_by     uuid,
  edited_by_name text,
  edited_at     timestamptz not null default now()
);

create index payment_method_edit_log_store_date_idx on pos.payment_method_edit_log (store_id, edited_at desc);

alter table pos.payment_method_edit_log enable row level security;
