-- Cambodia POS: ハッピーアワー(時間帯)価格
-- pos.menu_items に「ハッピーアワー価格」カラムを追加し、対象商品にのみ値を設定する。
-- null のままの商品はハッピーアワー中も通常価格のまま (レジ画面側は
-- happy_hour_price が設定されていて、かつハッピーアワー時間内の商品だけ
-- 価格を差し替える)。時間帯そのもの (開始/終了・ON/OFF) は
-- pos.stores.settings (一般設定) 側で管理する (追加マイグレーション不要)。

alter table pos.menu_items add column if not exists happy_hour_price numeric(10,2);

do $mainblock$
declare
  v_store_id uuid := 'e5fd7313-71d0-464d-8637-95142ca087a2';
begin
  -- 0005 のメニュー登録がまだの場合は対象商品が無いので何もしない (エラーにはならない)。

  -- 生ビール(グラス): 通常 $1.20 → ハッピーアワー $0.8
  update pos.menu_items set happy_hour_price = 0.8
  where store_id = v_store_id and name = '生ビール グラス';

  -- 焼酎(グラス基準価格) & ハイボール: 通常 $3.50 → ハッピーアワー $2.5
  update pos.menu_items set happy_hour_price = 2.5
  where store_id = v_store_id and name in ('ARAWAZA', 'DAIYAME', 'いいちこ', 'カンポットハイボール');

  raise notice 'happy hour price seed complete: % items updated', (
    select count(*) from pos.menu_items where store_id = v_store_id and happy_hour_price is not null
  );
end $mainblock$;
