-- Check PENDING_request_logs on the real database.
--
-- Run AFTER the migration, as the SQL editor's own role (postgres), the whole file at once. It opens its own
-- transaction and ends in ROLLBACK, so the probe row it writes is not kept. Output: one row per check; any result
-- containing "(bad)" is a failure.

begin;
create temp table _r (check_name text, result text);

insert into _r select 'table exists with RLS on',
  case when (select relrowsecurity from pg_class where oid = 'public.request_logs'::regclass) then 'ok' else '(bad)' end;
insert into _r select 'no policies (server only)',
  case when not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'request_logs') then 'ok' else '(bad)' end;
insert into _r select 'anon and authenticated have no table rights',
  case when not has_table_privilege('anon', 'public.request_logs', 'select')
        and not has_table_privilege('authenticated', 'public.request_logs', 'select')
        and not has_table_privilege('authenticated', 'public.request_logs', 'insert') then 'ok' else '(bad)' end;
insert into _r select 'security_traffic only for service_role',
  case when has_function_privilege('service_role', 'public.security_traffic(timestamp with time zone)', 'execute')
        and not has_function_privilege('anon', 'public.security_traffic(timestamp with time zone)', 'execute')
        and not has_function_privilege('authenticated', 'public.security_traffic(timestamp with time zone)', 'execute') then 'ok' else '(bad)' end;
insert into _r select 'purge job scheduled daily',
  case when exists (select 1 from cron.job where jobname = 'purge-request-logs' and command = 'select public.purge_request_logs()') then 'ok' else '(bad)' end;

-- A request stored twice (two log lines) is one row.
insert into public.request_logs (log_key, at, ip, method, path, status, bytes_out)
  values ('r:verify-probe', now(), '203.0.113.9', 'GET', '/verify', 200, 1234)
  on conflict (log_key) do nothing;
insert into public.request_logs (log_key, at, ip, method, path, status, bytes_out)
  values ('r:verify-probe', now(), '203.0.113.9', 'GET', '/verify', 200, 1234)
  on conflict (log_key) do nothing;
insert into _r select 'one row per request id',
  case when (select count(*) from public.request_logs where log_key = 'r:verify-probe') = 1 then 'ok' else '(bad)' end;
insert into _r select 'security_traffic reads it back',
  case when (public.security_traffic(now() - interval '1 hour') -> 'by_bytes') @> '[{"ip": "203.0.113.9"}]'::jsonb then 'ok' else '(bad)' end;

select * from _r;
rollback;
