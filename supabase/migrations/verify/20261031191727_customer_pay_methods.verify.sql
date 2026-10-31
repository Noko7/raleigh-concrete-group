-- Check customer_pay_methods. One row per check; "(bad)" is a failure. Reads no customer details.
select 'column exists, text[], nullable' as check_name,
       case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'quote_requests'
                          and column_name = 'customer_pay_methods' and data_type = 'ARRAY' and is_nullable = 'YES')
            then 'ok' else '(bad)' end as result
union all
select 'check constraint present',
       case when exists (select 1 from pg_constraint where conname = 'qr_customer_pay_methods_chk'
                          and conrelid = 'public.quote_requests'::regclass) then 'ok' else '(bad)' end;
