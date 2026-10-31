-- Check the staff card-payment constraint. Prints one row per check; "(bad)" is a failure. Reads no staff details.
select 'constraint allows card and five methods' as check_name,
       case when pg_get_constraintdef(oid) like '%card%' and pg_get_constraintdef(oid) like '%<= 5%' then 'ok' else '(bad)' end as result
  from pg_constraint where conname = 'staff_agreement_fields_chk' and conrelid = 'public.staff'::regclass;
