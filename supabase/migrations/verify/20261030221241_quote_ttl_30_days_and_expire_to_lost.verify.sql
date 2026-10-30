-- Check 20261030221241_quote_ttl_30_days_and_expire_to_lost on the real database.
--
-- Run AFTER the migration, as the SQL editor's own role (postgres), the whole file at once. It opens its own
-- transaction and ends in ROLLBACK, so nothing it does is kept. It never inserts a quote_requests row (the
-- disabled send_to_make trigger would post it to an outside webhook if it were ever re-enabled); it only
-- back-dates existing jobs inside the transaction. Output: one PASS/FAIL/SKIP line per check, then an error if
-- anything FAILed.

begin;
create temp table _r (check_name text, result text) on commit drop;

-- 1. Scheduled every 5 minutes.
insert into _r
select 'cron job scheduled every 5 minutes',
       case when exists (select 1 from cron.job where jobname = 'expire-unanswered-quotes'
                           and schedule = '*/5 * * * *' and command = 'select public.expire_unanswered_quotes()')
            then 'PASS' else 'FAIL' end;

-- 2. Not callable through the REST API.
insert into _r
select 'anon and authenticated cannot execute it',
       case when not has_function_privilege('anon', 'public.expire_unanswered_quotes()', 'execute')
             and not has_function_privilege('authenticated', 'public.expire_unanswered_quotes()', 'execute')
            then 'PASS' else 'FAIL' end;

-- 3. Nothing left in Quoted past its date (the migration's own run cleared them).
insert into _r
select 'no unanswered Quoted job is past its expiry',
       case when not exists (select 1 from public.quote_requests where status = 'quoted'
                               and customer_response is null and quote_expires_at <= now())
            then 'PASS' else 'FAIL' end;

-- 4. The sweep, on real rows: an unanswered Quoted job moves; an answered one and an Approved one do not.
do $$
declare
  q_open uuid; q_answered uuid; q_approved uuid; s text; n int;
begin
  select id into q_open from public.quote_requests
   where status = 'quoted' and customer_response is null order by is_test desc, updated_at desc limit 1;
  select id into q_answered from public.quote_requests
   where status = 'quoted' and customer_response is not null order by is_test desc limit 1;
  select id into q_approved from public.quote_requests
   where status = 'approved' order by is_test desc limit 1;

  if q_open is null then
    insert into _r values ('sweep moves an expired unanswered Quoted job', 'SKIP (none to test on)');
  else
    update public.quote_requests set quote_expires_at = now() - interval '1 minute' where id = q_open;
    -- A customer text held for quiet hours, and a crew one, both queued for this job.
    insert into public.quote_messages (quote_id, kind, role, to_phone, body, send_after)
    values (q_open, 'verify_customer', 'customer', '+15550000000', 'verify', now() + interval '8 hours'),
           (q_open, 'verify_crew', 'crew', '+15550000001', 'verify', now() + interval '8 hours');
    perform public.expire_unanswered_quotes();
    select status into s from public.quote_requests where id = q_open;
    select count(*) into n from public.quote_events
     where quote_id = q_open and type = 'status_changed' and meta->>'reason' = 'expired'
       and created_at = now();
    insert into _r values ('sweep moves an expired unanswered Quoted job',
                           case when s = 'lost' and n = 1 then 'PASS' else 'FAIL (' || s || ', ' || n || ' events)' end);
    insert into _r
    select 'the customer is not texted: their queued text is cancelled, the crew''s is not',
           case when bool_and((kind = 'verify_customer') = (cancelled_at is not null)) then 'PASS' else 'FAIL' end
      from public.quote_messages where quote_id = q_open and kind in ('verify_customer', 'verify_crew');
  end if;

  if q_answered is null then
    insert into _r values ('sweep leaves an answered quote alone', 'SKIP (none to test on)');
  else
    update public.quote_requests set quote_expires_at = now() - interval '1 minute' where id = q_answered;
    perform public.expire_unanswered_quotes();
    select status into s from public.quote_requests where id = q_answered;
    insert into _r values ('sweep leaves an answered quote alone', case when s = 'quoted' then 'PASS' else 'FAIL' end);
  end if;

  if q_approved is null then
    insert into _r values ('sweep leaves Approved alone', 'SKIP (none to test on)');
  else
    update public.quote_requests set quote_expires_at = now() - interval '1 minute' where id = q_approved;
    perform public.expire_unanswered_quotes();
    select status into s from public.quote_requests where id = q_approved;
    insert into _r values ('sweep leaves Approved alone', case when s = 'approved' then 'PASS' else 'FAIL' end);
  end if;
end $$;

select * from _r;
do $$ begin
  if exists (select 1 from _r where result like 'FAIL%') then raise exception 'verify: something FAILed (see rows above)'; end if;
  raise notice 'ALL PASSED';
end $$;

rollback;
