-- 2026-09-29: Tomから渡された最新の経費台帳Excel (___2026_Daily_account_table_improved_v2.xlsm)
-- 1〜8月の実データと、0023時点のマスタを比較し、まだ登録されていない仕入れ先・費目を追加する。
-- (Tom「今までの履歴が入ったデータを渡します。精度を高めてください」への対応。過去の経費
-- レコード自体はここでは取り込まない — 今月の集計・レポートに影響させないため、マスタ
-- (プルダウン候補) の追加のみ行う。)
--
-- 0023 と同じく、注記 (括弧内) だけが違う表記ゆれは追加していない (例:
-- 「Rent ond others (賃料他）」は全角カッコの表記ゆれのみで 0023 の
-- 「Rent ond others (賃料他)」と実質同じため対象外)。一方、口座番号や店舗名の詳細度が
-- 違うもの (例: 「Electricite du Cambodge」と「Electricite du Cambodge - EDC 5655410」) は、
-- レシート本文の表記がその都度違うためOCR一致率を上げる目的で両方登録している。
--
-- 冪等 (何度実行しても重複登録されない): 同じ store_id + name が既に存在する行は insert しない。

with next_sort as (
  select coalesce(max(sort_order), -1) + 1 as start_sort
  from pos.expense_categories
  where store_id = 'e5fd7313-71d0-464d-8637-95142ca087a2'
),
new_rows (name, rn) as (
  values
    ('Supplies expense (消耗品費)', 0)
)
insert into pos.expense_categories (store_id, name, sort_order)
select 'e5fd7313-71d0-464d-8637-95142ca087a2', nr.name, ns.start_sort + nr.rn
from new_rows nr
cross join next_sort ns
where not exists (
  select 1 from pos.expense_categories ec
  where ec.store_id = 'e5fd7313-71d0-464d-8637-95142ca087a2' and ec.name = nr.name
);

with next_sort as (
  select coalesce(max(sort_order), -1) + 1 as start_sort
  from pos.expense_vendors
  where store_id = 'e5fd7313-71d0-464d-8637-95142ca087a2'
),
new_rows (name, rn) as (
  values
    ('1001 APP GF (AEON)', 0),
    ('AEON', 1),
    ('BROWN PP CITY CENTER', 2),
    ('BUDDY''S MARKETING JP CO., LTD. (調味料サプライヤー)', 3),
    ('CHAN SOKDA', 4),
    ('CHOEM LAI', 5),
    ('CHUM PAKDEY', 6),
    ('DFI LUCKY TOUL TUMPONG 2', 7),
    ('E-Bakery by V.SOK (パン屋)', 8),
    ('Electricite du Cambodge (電気代)', 9),
    ('Electricite du Cambodge - EDC 5655410 (電気代)', 10),
    ('HOEU SREYLEAK (肉屋COM)', 11),
    ('HON MENEA 500514159', 12),
    ('HUY SREYMOM', 13),
    ('KASAHARA TAKUYA (プノンジュース)', 14),
    ('KHORN VUTHY', 15),
    ('KIMVY NHIK', 16),
    ('KOY SEYHUN', 17),
    ('KOY SOCHEATA', 18),
    ('LANG SIVMEY', 19),
    ('LIM MONIN,MS\/ BY RINA,MS (Krud)', 20),
    ('LOCH NOVANN', 21),
    ('LUCKY EXPRESS', 22),
    ('LUN PHALA', 23),
    ('MAO SREYPINE (酒屋)', 24),
    ('MORN NITH (肉サプライヤー)', 25),
    ('MS STORE TTP', 26),
    ('MV TONLE (トップバリュー)', 27),
    ('Mey Mey', 28),
    ('NOEURN KEO 005551423', 29),
    ('OEURN SREYMEAS', 30),
    ('PHAL DEVIT (牛肉配送代)', 31),
    ('PHAN SARAN', 32),
    ('PROEM PHEAROM (氷屋)', 33),
    ('Pastry by S.HASHIZUME', 34),
    ('SE PISETH 989545454', 35),
    ('SEANG CHANTHA (大家)', 36),
    ('SENG SOKENG', 37),
    ('SOEUNG CHANLY', 38),
    ('SOK PIN (Market)', 39),
    ('SONG SOPHEA (キッチン用ガス)', 40),
    ('Smart (携帯代)', 41),
    ('THAI HUOT SUPERMARKET B1', 42),
    ('THAM TANGKEA', 43),
    ('TRAN THI DAO', 44),
    ('TRY KIMCHHAY (お米屋)', 45),
    ('UM VIRAK', 46),
    ('W24 by A.E', 47),
    ('YON SA', 48),
    ('កាន់ ហេង', 49),
    ('ជឹម ឡៃ', 50),
    ('ភឿក ស្រ意ពៅ', 51),
    ('រុន សេរីវឌ្ឃនៈ', 52),
    ('សយ ស្រី', 53),
    ('សរ គឹមសូត', 54),
    ('ស៊ិន សាលេន', 55)
)
insert into pos.expense_vendors (store_id, name, sort_order)
select 'e5fd7313-71d0-464d-8637-95142ca087a2', nr.name, ns.start_sort + nr.rn
from new_rows nr
cross join next_sort ns
where not exists (
  select 1 from pos.expense_vendors ev
  where ev.store_id = 'e5fd7313-71d0-464d-8637-95142ca087a2' and ev.name = nr.name
);
