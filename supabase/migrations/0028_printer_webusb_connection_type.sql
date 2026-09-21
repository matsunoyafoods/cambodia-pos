-- WebUSB直接印刷方式 (2026-09-21 追加)。中継PCが無い店舗で、Android Chromeから
-- USB接続のレシートプリンターへブラウザ標準のWebUSB APIで直接印刷できるようにする。
-- (iPad/iPhoneのSafariはWebUSB非対応。既存の passprnt はBluetooth専用、webusbはUSB専用)
alter table pos.printers drop constraint printers_connection_type_check;
alter table pos.printers add constraint printers_connection_type_check
  check (connection_type = any (array['usb_agent'::text, 'lan'::text, 'bluetooth'::text, 'passprnt'::text, 'webusb'::text]));
