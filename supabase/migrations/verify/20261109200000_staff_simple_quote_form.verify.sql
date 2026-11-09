-- Check 20261109200000_staff_simple_quote_form on the real database. Read-only.
-- Output: one row per check; any result containing "(bad)" is a failure.

select 'column exists, boolean, not null, default false' as check_name,
  case when exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'staff' and column_name = 'simple_quote_form'
       and data_type = 'boolean' and is_nullable = 'NO' and column_default = 'false'
  ) then 'ok' else '(bad)' end as result
union all
select 'no staff row is null',
  case when not exists (select 1 from public.staff where simple_quote_form is null) then 'ok' else '(bad)' end
union all
select 'only owners can write staff (policy unchanged)',
  case when exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'staff' and policyname = 'owner manages staff')
       then 'ok' else '(bad)' end;
