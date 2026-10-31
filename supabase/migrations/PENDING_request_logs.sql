-- Raleigh Concrete Group - request logs from Vercel, for the owner's security page
-- Undo: undo/PENDING_request_logs.undo.sql. Check: verify/PENDING_request_logs.verify.sql.
--
-- A Vercel Log Drain posts every request the website serves to /api/logs/vercel; the server checks the drain's
-- signature and stores one row per request here (client IP, method, path with tokens masked and query values
-- dropped, status, bytes sent, user agent, cache, firewall action). The owner's security page reads it back as
-- totals, data out per IP, noisy and probing IPs, and the largest responses, to spot data leaving the site.
--
--   1. request_logs: one row per request, keyed by Vercel's request id (a request's several log lines are one
--      row). Server only: RLS on with no policies, and no grants to anon or authenticated. The page reads it
--      through security_traffic() after checking the owner.
--   2. security_traffic(since): everything the page shows for a window, in one call, as JSON. Service role only.
--   3. Kept 30 days: purge_request_logs() runs daily on pg_cron (job purge-request-logs).

set local lock_timeout = '5s';

-- ── 1. The log ──────────────────────────────────────────────────────────────
create table public.request_logs (
  id bigint generated always as identity,
  log_key text not null,
  at timestamp with time zone not null,
  ip text,
  method text,
  host text,
  path text not null,
  status integer,
  bytes_out bigint,
  source text,
  ua text,
  referer_host text,
  region text,
  cache text,
  waf_action text,
  waf_rule text,
  request_id text,
  deployment_id text,
  probe text,
  received_at timestamp with time zone default now() not null,
  constraint request_logs_pkey PRIMARY KEY (id),
  constraint request_logs_log_key_key UNIQUE (log_key),
  constraint request_logs_chk CHECK (
    char_length(log_key) <= 130 and char_length(path) <= 520
    and (ip is null or char_length(ip) <= 64)
    and (ua is null or char_length(ua) <= 300)
    and (status is null or status between 0 and 999)
    and (bytes_out is null or bytes_out >= 0)
  )
);
create index request_logs_at_idx on public.request_logs using btree (at desc);
create index request_logs_probe_at_idx on public.request_logs using btree (at desc) where probe is not null;

alter table public.request_logs enable row level security;
revoke all on table public.request_logs from anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on public.request_logs to service_role;
revoke all on sequence public.request_logs_id_seq from anon, authenticated;

-- ── 2. What the security page shows ─────────────────────────────────────────
create or replace function public.security_traffic(p_since timestamp with time zone)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with w as (
    select * from public.request_logs where at >= greatest(p_since, now() - interval '31 days')
  ),
  per_ip as (
    select ip,
           count(*) as requests,
           coalesce(sum(bytes_out), 0) as bytes,
           count(*) filter (where status between 400 and 499) as c4xx,
           count(*) filter (where status >= 500) as c5xx,
           count(*) filter (where probe is not null) as probes,
           count(distinct path) as paths,
           min(at) as first_seen,
           max(at) as last_seen,
           mode() within group (order by path) as top_path,
           mode() within group (order by ua) as ua
      from w where ip is not null group by ip
  )
  select jsonb_build_object(
    'totals', (select jsonb_build_object(
        'requests', count(*),
        'bytes', coalesce(sum(bytes_out), 0),
        'ips', count(distinct ip),
        'c4xx', count(*) filter (where status between 400 and 499),
        'c5xx', count(*) filter (where status >= 500),
        'waf', count(*) filter (where waf_action is not null and waf_action not in ('allow', 'log')),
        'probes', count(*) filter (where probe is not null),
        'first', min(at), 'last', max(at)) from w),
    'last_received', (select received_at from public.request_logs order by id desc limit 1),
    'series', coalesce((select jsonb_agg(x order by x.bucket) from (
        select date_trunc('hour', at) as bucket, count(*) as requests, coalesce(sum(bytes_out), 0) as bytes,
               count(*) filter (where status >= 400) as errors
          from w group by 1) x), '[]'::jsonb),
    'median_ip_bytes', (select coalesce(percentile_cont(0.5) within group (order by bytes), 0) from per_ip),
    'by_bytes', coalesce((select jsonb_agg(x) from (select * from per_ip order by bytes desc limit 20) x), '[]'::jsonb),
    'by_requests', coalesce((select jsonb_agg(x) from (select * from per_ip order by requests desc limit 10) x), '[]'::jsonb),
    'by_errors', coalesce((select jsonb_agg(x) from (select * from per_ip where c4xx + c5xx > 0 order by c4xx + c5xx desc limit 10) x), '[]'::jsonb),
    'by_paths', coalesce((select jsonb_agg(x) from (select * from per_ip order by paths desc limit 10) x), '[]'::jsonb),
    'probes', coalesce((select jsonb_agg(x) from (
        select ip, count(*) as hits, array_agg(distinct probe) as kinds,
               (array_agg(distinct path))[1:5] as examples, max(at) as last_seen,
               mode() within group (order by ua) as ua
          from w where probe is not null group by ip order by count(*) desc limit 25) x), '[]'::jsonb),
    'largest', coalesce((select jsonb_agg(x) from (
        select at, ip, method, path, status, bytes_out, ua from w where bytes_out is not null
         order by bytes_out desc limit 15) x), '[]'::jsonb),
    'routes', coalesce((select jsonb_agg(x) from (
        select regexp_replace(split_part(path, '?', 1), '^(/[^/]*(/[^/]*)?).*$', '\1') as route,
               count(*) as requests, coalesce(sum(bytes_out), 0) as bytes, count(distinct ip) as ips,
               max(bytes_out) as biggest
          from w group by 1 order by 3 desc limit 20) x), '[]'::jsonb),
    'statuses', coalesce((select jsonb_object_agg(s, n) from (
        select coalesce(status::text, 'none') as s, count(*) as n from w group by 1) x), '{}'::jsonb)
  );
$$;
revoke all on function public.security_traffic(timestamp with time zone) from public, anon, authenticated;
grant execute on function public.security_traffic(timestamp with time zone) to service_role;

-- ── 3. Kept 30 days ─────────────────────────────────────────────────────────
create or replace function public.purge_request_logs()
returns integer
language sql
security definer
set search_path = public
as $$
  with gone as (delete from public.request_logs where at < now() - interval '30 days' returning 1)
  select count(*)::integer from gone;
$$;
revoke all on function public.purge_request_logs() from public, anon, authenticated;
grant execute on function public.purge_request_logs() to service_role;

select cron.schedule('purge-request-logs', '17 7 * * *', 'select public.purge_request_logs()');
