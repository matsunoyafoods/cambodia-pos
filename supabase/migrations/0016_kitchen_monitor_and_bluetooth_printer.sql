-- キッチンモニター機能 (2026-09-03 追加): 紙の厨房伝票の代わりに、確定・厨房送信された
-- 注文品目をキッチン用タブレット画面に一覧表示し、調理完了をタップで記録できるようにする列。
-- 既存の sent_to_kitchen_at (厨房送信時刻) と組み合わせて使う:
--   sent_to_kitchen_at IS NOT NULL AND kitchen_done_at IS NULL  → キッチンモニターの「未対応」一覧
-- kitchen_done_by_name はスタッフIDへの外部キーを持たせず (Phase A由来の外部キー不具合が
-- 度々あったため、決済方法・レジ締めの confirmed_by_name と同じ「氏名スナップショット」方式)、
-- 完了操作をした時点のスタッフ表示名をそのまま保存する。
alter table pos.order_items
  add column kitchen_done_at timestamptz null,
  add column kitchen_done_by_name text null;

-- プリンター接続方式に bluetooth を追加。店舗常駐の中継PC/ミニPCとプリンターをOSのBluetooth
-- (SPPプロファイル) でペアリングし、割り当てられたシリアルポート/デバイスパスへ生バイトを
-- 送信する方式 (print-agent/agent.mjs 側で対応)。既存の device_name 列を usb_agent と同じ
-- 意味で流用する (ペアリング後のデバイスパス。例: macOSなら /dev/tty.TSP650II, Windowsなら COM5)。
alter table pos.printers drop constraint printers_connection_type_check;
alter table pos.printers add constraint printers_connection_type_check
  check (connection_type = any (array['usb_agent'::text, 'lan'::text, 'bluetooth'::text]));
