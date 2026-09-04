-- スタッフ権限の拡張 (2026-09-04)。
-- Tom「スタッフタブの中でスタッフ権限をつけられるようにしてください。
-- マネージャー／サブマネージャー／社員／バイトにしてください。」
--
-- 既存の 3段階 (owner/manager/staff) に、マネージャーとほぼ同等の権限を持つが
-- スタッフの給料・AI診断・売上レポートは見られない「サブマネージャー (sub_manager)」と、
-- 旧 staff を分割した「社員 (employee)」「バイト (part_time)」を追加する。
-- アプリ側の権限判定は src/lib/pos-auth.ts の PosStaffRole / ROLE_RANK / withPosStaff を参照。

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'pos.staff'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%role%'
  ) then
    execute (
      select 'alter table pos.staff drop constraint ' || quote_ident(conname)
      from pg_constraint
      where conrelid = 'pos.staff'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%role%'
      limit 1
    );
  end if;
end $$;

alter table pos.staff
  add constraint staff_role_check check (role in ('owner', 'manager', 'sub_manager', 'employee', 'part_time'));

-- 既存の 'staff' 行は 'employee' (社員) 扱いに寄せる。
update pos.staff set role = 'employee' where role = 'staff';
