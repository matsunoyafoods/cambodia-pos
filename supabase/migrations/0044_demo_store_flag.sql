-- 営業デモ用の「使い回しデモ店舗」フラグ。
-- Tom「デモアカウント店舗を作りたいです。導入を検討している店舗のメニュー表をインポートすると
-- 店舗のデモ画面ができるようにしたい」への対応 (multi-tenant-productization-addendum-2026-11.md
-- 追記3、2026-11-05 Tom確認済み: 使い回し型の1店舗、まずテキスト貼り付けインポートのみ)。
--
-- is_demo = true の店舗だけが、契約店舗管理画面 (cambodia-pos-admin) のメニュー一括インポート
-- (既存メニュー・注文履歴を全削除して新しいメニューに差し替える破壊的操作) の対象になれる。
-- 誤って本番稼働中の店舗のメニューを消さないための安全装置。

alter table pos.stores
  add column is_demo boolean not null default false;

comment on column pos.stores.is_demo is
  '営業デモ用の使い回し店舗かどうか。true の店舗だけが契約店舗管理画面のメニュー一括
   インポート(破壊的操作)の対象になれる安全装置。デモ店舗は trial_ends_at を null の
   まま運用する想定 (既存の0042 cronロジックで null は自動失効の対象外のため)。';
