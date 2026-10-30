-- Undo 20261030200000_quote_ttl_30_days_and_expire_to_lost. Also set QUOTE_TTL_DAYS back to 10 in
-- src/lib/crm/constants.ts, or quotes sent afterwards keep getting 30 days.
--
--   * Stops and removes the 5-minute sweep. pg_cron stays installed (harmless; drop it by hand if wanted).
--   * Puts back the expiry dates the migration moved, from its expiry_extended events, but only where the
--     date is still the one it set: a quote re-sent since has a newer date that belongs to that send.
--   * Jobs the sweep moved to Lost STAY in Lost. Each is logged as status_changed with reason "expired";
--     list them with:
--       select quote_id, created_at from public.quote_events
--        where type = 'status_changed' and meta->>'reason' = 'expired' order by created_at;

set local lock_timeout = '5s';

select cron.unschedule('expire-unanswered-quotes')
 where exists (select 1 from cron.job where jobname = 'expire-unanswered-quotes');

drop function if exists public.expire_unanswered_quotes();

update public.quote_requests q
   set quote_expires_at = (e.meta->>'from')::timestamptz
  from public.quote_events e
 where e.quote_id = q.id
   and e.type = 'expiry_extended'
   and q.quote_expires_at = (e.meta->>'to')::timestamptz;

delete from public.quote_events where type = 'expiry_extended';
