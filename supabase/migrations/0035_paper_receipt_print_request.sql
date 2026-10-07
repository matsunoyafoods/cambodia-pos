-- 紙レシート発行フロー (2026-10-07 追加)。Tom「お客さんが紙で欲しいと言った場合」。
-- プリンターはPassPRNT (レジ端末とBluetoothペアリング) のため、ハンディ自身はプリンターに
-- 印刷命令を送れない。ハンディの「紙レシートでもらう」は (request-paper-receipt/route.ts で)
-- 現金会計を確定させるところまでをサーバー側で行い、このカラムを立てるだけにする。
-- レジ画面はテーブルマップのポーリング (table-billing-status/route.ts) でこのカラムが
-- 立っている注文を見つけ、バナー表示→スタッフの1タップで実際の印刷命令 (PassPRNT URL
-- スキーム) をレジ端末自身のブラウザから送る (pos-app.tsx)。印刷後は mark-printed/route.ts
-- がこのカラムをNULLに戻す。
alter table pos.orders add column if not exists print_requested_at timestamptz;
