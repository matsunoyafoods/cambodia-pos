-- 契約店舗管理画面 (cambodia-pos-admin) が、新規店舗オーナーへの初期設定メールのリンク先
-- (https://<この店舗の本番URL>/owner-setup/<token>) を組み立てるために、各店舗の本番URLを
-- pos.stores に記録しておく必要がある (D-簡易は店舗ごとに別Vercelデプロイ=別ドメインのため、
-- コードから自動では分からない)。0042で追加し忘れていたため追加マイグレーション。

alter table pos.stores
  add column domain text;

comment on column pos.stores.domain is
  'この店舗のVercelデプロイの本番URL (例: https://imhungry-newstore.vercel.app)。
   契約店舗管理画面がオーナー初期設定メールのリンクを組み立てる際に使う。
   店舗作成時にVercelデプロイ完了後、手動で設定する。';
