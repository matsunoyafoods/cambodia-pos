-- レジプリンターの接続方式に 'passprnt' を追加 (2026-09-03)。
--
-- 背景: 前回 (0016) の Bluetooth 対応は「店舗に常時稼働の中継PC/mini-PCがあり、そこで
-- print-agent (Node.js) が動く」前提だった。しかしTomの店舗にはPCが無く、あるのは
-- iPad・Androidタブレット・スマホのみ。Star Micronics純正の無料アプリ「PassPRNT」を
-- レジ端末(iPad/Android)にインストールし、その端末自体をプリンターと直接Bluetoothペア
-- リングすれば、中継PC・print-agentが一切不要になる (URLスキーム経由でレシートHTMLを
-- PassPRNTへ渡し、PassPRNTが印刷してブラウザへ戻る)。
--
-- 'bluetooth' (中継PC + print-agent方式) は将来PCがある店舗向けに残す。'passprnt' は
-- 中継機不要でレジ端末に直接印刷させる方式として新規追加。両者は共存可能。

alter table pos.printers drop constraint printers_connection_type_check;
alter table pos.printers add constraint printers_connection_type_check
  check (connection_type = any (array['usb_agent'::text, 'lan'::text, 'bluetooth'::text, 'passprnt'::text]));
