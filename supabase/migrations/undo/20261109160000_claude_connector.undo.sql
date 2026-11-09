-- Undo 20261109160000_claude_connector: the connector's tables, its purge and the daily job.
-- Every connection ends (Claude's tokens stop working) and the connector's activity log is lost. Nothing else
-- reads these tables. Turn the connector off on the Security page first, or the app logs errors until it's
-- redeployed without it.

set local lock_timeout = '5s';

select cron.unschedule('purge-mcp') where exists (select 1 from cron.job where jobname = 'purge-mcp');
drop function if exists public.purge_mcp();
drop table if exists public.mcp_activity;
drop table if exists public.mcp_tokens;
drop table if exists public.mcp_auth_codes;
drop table if exists public.mcp_grants;
drop table if exists public.mcp_clients;
