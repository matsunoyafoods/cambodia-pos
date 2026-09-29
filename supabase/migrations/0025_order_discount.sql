-- 会計合計からの値引き (2026-09-15 修正)。
--
-- checkout-screen.tsx の OrderDiscountEditor / pos-app.tsx の totals.orderDiscount は
-- 以前から実装済みで、会計完了時に pos.orders.order_discount へ保存しようとしていたが、
-- このカラムを作るマイグレーションが漏れていた。そのため会計合計に値引きを設定して
-- 「会計完了」を押すと、存在しないカラムへの update でサーバーエラーになり会計が
-- 完了できなかった (Tom「会計合計を割引する方法がない」への対応 = 機能自体は
-- 実装済みだったが、このカラム追加漏れで動作していなかった)。

alter table pos.orders add column if not exists order_discount numeric(10,2) not null default 0;
