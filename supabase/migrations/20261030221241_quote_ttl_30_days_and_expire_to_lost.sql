-- Raleigh Concrete Group - quotes are good for 30 days, and an unanswered one moves to Lost when it runs out
-- Undo: undo/20261030221241_quote_ttl_30_days_and_expire_to_lost.undo.sql.
-- Check: verify/20261030221241_quote_ttl_30_days_and_expire_to_lost.verify.sql.
--
-- Goes with QUOTE_TTL_DAYS = 30 in src/lib/crm/constants.ts (was 10), which stamps quotes sent from now on.
--
--   1. Every unanswered quote with an expiry moves 20 days later: stamped "last send + 10 days", it becomes
--      "last send + 30 days", as if the rule had always been 30. (One quote from the 7-day era, long expired
--      and already Lost, lands on last send + 27; it stays expired either way.) Each one gets an
--      expiry_extended event with the old and new dates, which the job log shows and the undo reads.
--      Quotes sent before expiry existed (quote_expires_at null) keep no expiry. Answered quotes never expire,
--      so they are not touched. Apply AFTER the code with QUOTE_TTL_DAYS = 30 is deployed: only dates within
--      10 days of now are moved (a 10-day stamp always is; a 30-day one is not, for its first 20 days).
--   2. expire_unanswered_quotes() moves every job still in Quoted, with no answer from the customer, whose
--      quote_expires_at has passed, to Lost, and logs status_changed {from quoted, to lost, reason expired}
--      (actor null: the job log shows "Automatic"). The customer is never told: nothing is sent, and any
--      customer text still queued for the job (held for quiet hours) is cancelled. Only Quoted moves: Approved and every later stage are
--      left alone whatever their date says. The update re-checks every condition on the row it changes, so
--      a customer approving in the same instant wins. Resending the quote revives it as before: a send
--      sets the status back to Quoted and re-stamps 30 days.
--   3. pg_cron runs it every 5 minutes, so a quote is in Lost within 5 minutes of the moment it expired
--      (the customer's page already shows it expired at that exact moment). Vercel's two daily crons are
--      taken, and a daily run would leave expired quotes in Quoted for up to a day.
--   4. It runs once at the end of this migration, which moves the quotes already past their new date.
--
-- The function is SECURITY DEFINER for pg_cron and EXECUTE stays off PUBLIC (granted to service_role only),
-- so nobody can call it through the REST API. Running as the cron's role, auth.uid() is null, which
-- guard_quote_money_columns() lets through; status is not a guarded column.

set local lock_timeout = '5s';

-- ── 1. Re-date the unanswered quotes ────────────────────────────────────────
with moved as (
  update public.quote_requests q
     set quote_expires_at = q.quote_expires_at + interval '20 days'
   where q.customer_response is null
     and q.quote_expires_at is not null
     -- Only 10-day stamps. Applied after the 30-day code is live, a quote sent in between already has 30
     -- days and ends more than 10 days out; this keeps it from getting 50.
     and q.quote_expires_at <= now() + interval '10 days'
  returning q.id, q.quote_expires_at - interval '20 days' as was, q.quote_expires_at as now_is
)
insert into public.quote_events (quote_id, type, meta)
select id, 'expiry_extended', jsonb_build_object('from', was, 'to', now_is, 'ttl_days', 30)
  from moved;

-- ── 2. The sweep ────────────────────────────────────────────────────────────
create or replace function public.expire_unanswered_quotes()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  moved integer;
begin
  -- One statement: move, log, and stop any customer text still queued for the job (a quiet-hours hold), so
  -- moving to Lost never reaches the customer. Every part runs even though only the count is read.
  with expired as (
    update public.quote_requests q
       set status = 'lost'
     where q.status = 'quoted'
       and q.customer_response is null
       and q.quote_expires_at is not null
       and q.quote_expires_at <= now()
    returning q.id, q.quote_expires_at
  ), logged as (
    insert into public.quote_events (quote_id, type, meta)
    select id, 'status_changed',
           jsonb_build_object('from', 'quoted', 'to', 'lost', 'reason', 'expired', 'expired_at', quote_expires_at)
      from expired
    returning quote_id
  ), stopped as (
    update public.quote_messages m
       set cancelled_at = now(),
           detail = 'Cancelled: the quote expired and the job moved to Lost.'
     where m.quote_id in (select id from expired)
       and m.role = 'customer'
       and m.sent_at is null
       and m.cancelled_at is null
       and m.send_after is not null
    returning m.id
  )
  select count(*) into moved from expired;
  return moved;
end;
$function$;

revoke execute on function public.expire_unanswered_quotes() from public, anon, authenticated;
grant execute on function public.expire_unanswered_quotes() to service_role;

-- ── 3. Every 5 minutes ──────────────────────────────────────────────────────
create extension if not exists pg_cron;
-- Same name replaces the job, so running this file twice leaves one schedule.
select cron.schedule('expire-unanswered-quotes', '*/5 * * * *', 'select public.expire_unanswered_quotes()');

-- ── 4. Catch up now ─────────────────────────────────────────────────────────
select public.expire_unanswered_quotes();
