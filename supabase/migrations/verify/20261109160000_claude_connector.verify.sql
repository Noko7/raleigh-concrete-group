-- Check 20261109160000_claude_connector on the real database.
--
-- Run AFTER the migration, as the SQL editor's own role (postgres), the whole file at once. It opens its own
-- transaction and ends in ROLLBACK, so the probe rows it writes are not kept. Output: one row per check; any
-- result containing "(bad)" is a failure.

begin;
create temp table _r (check_name text, result text);

insert into _r select 'all five tables have RLS on',
  case when (select count(*) from pg_class where relrowsecurity and oid in (
    'public.mcp_clients'::regclass, 'public.mcp_auth_codes'::regclass, 'public.mcp_grants'::regclass,
    'public.mcp_tokens'::regclass, 'public.mcp_activity'::regclass)) = 5 then 'ok' else '(bad)' end;
insert into _r select 'no policies (server only)',
  case when not exists (select 1 from pg_policies where schemaname = 'public' and tablename like 'mcp\_%') then 'ok' else '(bad)' end;
insert into _r select 'anon and authenticated have no table rights',
  case when not exists (
    select 1 from unnest(array['mcp_clients', 'mcp_auth_codes', 'mcp_grants', 'mcp_tokens', 'mcp_activity']) t
     where has_table_privilege('anon', 'public.' || t, 'select') or has_table_privilege('authenticated', 'public.' || t, 'select')
        or has_table_privilege('anon', 'public.' || t, 'insert') or has_table_privilege('authenticated', 'public.' || t, 'insert')
        or has_table_privilege('authenticated', 'public.' || t, 'update') or has_table_privilege('authenticated', 'public.' || t, 'delete'))
  then 'ok' else '(bad)' end;
insert into _r select 'purge_mcp only for service_role',
  case when has_function_privilege('service_role', 'public.purge_mcp()', 'execute')
        and not has_function_privilege('anon', 'public.purge_mcp()', 'execute')
        and not has_function_privilege('authenticated', 'public.purge_mcp()', 'execute') then 'ok' else '(bad)' end;
insert into _r select 'purge job scheduled daily',
  case when exists (select 1 from cron.job where jobname = 'purge-mcp' and command = 'select public.purge_mcp()') then 'ok' else '(bad)' end;

-- A connection for the first owner, end to end.
insert into public.mcp_clients (client_id, client_name, redirect_uris)
  values ('rcg_client_verify', 'Verify', array['https://claude.ai/api/mcp/auth_callback']);
insert into public.mcp_grants (id, client_id, client_name, staff_id, scope, expires_at)
  select '00000000-0000-4000-8000-0000000000aa', 'rcg_client_verify', 'Verify', id, 'crm.read', now() + interval '90 days'
    from public.staff where role = 'owner' order by created_at limit 1;
insert into public.mcp_tokens (token_hash, kind, grant_id, expires_at)
  values (repeat('a', 64), 'access', '00000000-0000-4000-8000-0000000000aa', now() + interval '1 hour');
insert into _r select 'token joins to its connection',
  case when exists (select 1 from public.mcp_tokens t join public.mcp_grants g on g.id = t.grant_id
                     where t.token_hash = repeat('a', 64) and g.revoked_at is null) then 'ok' else '(bad)' end;

-- The limits hold in the database, not only in the app.
do $$ begin
  insert into public.mcp_grants (client_id, client_name, staff_id, scope, expires_at)
    select 'rcg_client_verify', 'Verify', id, 'crm.write', now() + interval '1 day' from public.staff where role = 'owner' limit 1;
  insert into _r values ('only the read scope', '(bad)');
exception when check_violation then insert into _r values ('only the read scope', 'ok'); end $$;
do $$ begin
  insert into public.mcp_tokens (token_hash, kind, grant_id, expires_at)
    values (repeat('b', 64), 'refresh', '00000000-0000-4000-8000-0000000000aa', now() + interval '1 year');
  insert into _r values ('no token outlives 30 days', '(bad)');
exception when check_violation then insert into _r values ('no token outlives 30 days', 'ok'); end $$;
do $$ begin
  insert into public.mcp_clients (client_id, client_name, redirect_uris, auth_method)
    values ('rcg_client_verify2', 'Verify', array['https://claude.ai/api/mcp/auth_callback'], 'client_secret_post');
  insert into _r values ('a secret client must store a secret hash', '(bad)');
exception when check_violation then insert into _r values ('a secret client must store a secret hash', 'ok'); end $$;

-- Revoking by deleting the connection takes its tokens with it.
delete from public.mcp_grants where id = '00000000-0000-4000-8000-0000000000aa';
insert into _r select 'tokens go with their connection',
  case when not exists (select 1 from public.mcp_tokens where token_hash = repeat('a', 64)) then 'ok' else '(bad)' end;

select * from _r;
rollback;
