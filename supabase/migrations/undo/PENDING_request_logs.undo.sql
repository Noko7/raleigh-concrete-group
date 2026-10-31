-- Undo PENDING_request_logs: the request log, its read function, its purge and the daily job.
-- The stored request history (at most 30 days) is lost. Nothing else reads it.

set local lock_timeout = '5s';

select cron.unschedule('purge-request-logs') where exists (select 1 from cron.job where jobname = 'purge-request-logs');
drop function if exists public.purge_request_logs();
drop function if exists public.security_traffic(timestamp with time zone);
drop table if exists public.request_logs;
