-- 新規店舗の「本番URL自動発行」機能のための拡張。
-- cambodia-pos-admin から新規店舗を作ると、Vercelプロジェクト作成・環境変数設定・
-- 独自サブドメイン (<slug>.matsunoyafoods.com) 割り当て・初回デプロイまでを自動で行う
-- (multi-tenant-productization-addendum-2026-11.md 追記5、2026-11-05 Tom確認済み:
--  フル自動・matsunoyafoods.com はワイルドカードCNAMEでVercelに向ける方式)。

alter table pos.stores
  add column subdomain_slug text unique
    check (subdomain_slug ~ '^[a-z0-9-]{3,30}$'),
  add column vercel_project_id text,
  add column vercel_deployment_id text,
  add column provisioning_status text
    check (provisioning_status in ('pending', 'ready', 'error')),
  add column provisioning_error text;

comment on column pos.stores.subdomain_slug is
  'matsunoyafoods.com のサブドメイン名 (例: "sample" → sample.matsunoyafoods.com)。
   半角英数字とハイフンのみ、3〜30文字。自動発行フローでの一意性チェックに使う。
   手動でdomainを設定した既存店舗 (松之屋フーズ・デモ店舗など) はnullのまま。';
comment on column pos.stores.vercel_project_id is
  'この店舗のVercelプロジェクトID (例: prj_xxxx)。自動発行時にVercel APIのレスポンスから保存する。
   将来の再デプロイ・環境変数更新のために保持する。手動構築した店舗はnull。';
comment on column pos.stores.vercel_deployment_id is
  '自動発行フローで作成した初回デプロイのID (例: dpl_xxxx)。ビルド完了確認 (/provision のGET) の
   ポーリング対象。手動構築した店舗や、確認済みでしばらく経った店舗ではnullのままでもよい。';
comment on column pos.stores.provisioning_status is
  'null=自動発行フローの対象外(手動でVercelデプロイ・domainを設定した店舗)、
   pending=Vercelへのプロジェクト作成・デプロイ処理を開始した直後(ビルド中の可能性あり)、
   ready=デプロイ完了を確認済み、error=自動発行処理が失敗(provisioning_errorに詳細)。';
comment on column pos.stores.provisioning_error is
  '自動発行処理が失敗した場合のエラーメッセージ(Vercel APIのエラー内容等)。成功時はnullに戻す。';
