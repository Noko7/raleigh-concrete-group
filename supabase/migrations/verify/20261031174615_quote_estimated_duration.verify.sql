-- Check 20261031174615_quote_estimated_duration on the real database. Read-only apart from a rolled-back probe; prints one
-- row per check, and any result containing "(bad)" is a failure. No customer details are read.

begin;
select 'column exists, text, nullable' as check_name,
       case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'quote_requests'
                          and column_name = 'estimated_duration' and data_type = 'text' and is_nullable = 'YES')
            then 'ok' else '(bad)' end as result
union all
select 'length check present',
       case when exists (select 1 from pg_constraint where conname = 'qr_estimated_duration_chk'
                          and conrelid = 'public.quote_requests'::regclass) then 'ok' else '(bad)' end;
rollback;
