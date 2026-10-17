-- 大文字小文字・前後空白違いだけの重複費目名を統合する
-- (Tom「ingredientsが2個あって複雑になっている」への対応)。
-- POST /api/settings/expense-categories 側は既に重複登録を防止済み (0040 以前の修正)。
-- ここでは既存データのクリーンアップ:
-- 1) 各 store で、大文字小文字・前後空白を無視して同一とみなせる費目名が複数ある場合、
--    実際に過去の経費記録 (pos.expenses.category) で最も多く使われている表記を
--    正とする (使用件数が同じ場合は sort_order が小さい方)。
-- 2) 正とした表記以外になっている過去の経費記録のテキストを、正の表記に統一する。
--    (pos.expenses.category は本来「マスタを改名・削除しても過去の記録は変わらない」
--    スナップショット方式だが、これは改名ではなく表記違いの名寄せ)。
-- 3) 重複していたマスタ行 (pos.expense_categories) を削除する。

do $$
declare
  grp record;
  canonical record;
  dup record;
begin
  for grp in (
    select store_id, lower(trim(name)) as norm_name
    from pos.expense_categories
    group by store_id, lower(trim(name))
    having count(*) > 1
  )
  loop
    select ec.id, ec.name, ec.sort_order,
           (select count(*) from pos.expenses e
            where e.store_id = grp.store_id and e.category = ec.name) as usage_count
      into canonical
      from pos.expense_categories ec
     where ec.store_id = grp.store_id and lower(trim(ec.name)) = grp.norm_name
     order by usage_count desc, ec.sort_order asc
     limit 1;

    for dup in (
      select id, name
      from pos.expense_categories
      where store_id = grp.store_id
        and lower(trim(name)) = grp.norm_name
        and id <> canonical.id
    )
    loop
      update pos.expenses
         set category = canonical.name
       where store_id = grp.store_id and category = dup.name;

      delete from pos.expense_categories where id = dup.id;
    end loop;
  end loop;
end $$;
