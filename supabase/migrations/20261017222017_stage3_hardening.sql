-- Raleigh Concrete Group - stage 3: database hygiene
-- Applied to production 2026-10-17 as migration 20261017222017 (already live;
-- do not run again). Undo: undo/20261017222017_stage3_hardening.undo.sql.
-- The state it was written against: ../snapshots/2026-10-17-pre-stage3.sql.
--
--   1. The Make.com webhook trigger on new leads is disabled. Nothing uses the
--      scenario any more, and every lead insert was posting the whole row to it.
--      Disabled rather than dropped, so the undo is one ENABLE and the webhook URL
--      never has to live in this repo. To remove it for good, in the SQL Editor:
--        drop trigger send_to_make on public.quote_requests;
--   2. SECURITY DEFINER functions stop being callable by anyone through the REST
--      API. Their EXECUTE came from the built-in PUBLIC grant (proacl NULL), so
--      revoking from anon or authenticated alone changes nothing: it has to come
--      off PUBLIC. A trigger function needs no EXECUTE to fire - that is only
--      checked when the trigger is created - so the guards keep running.
--      is_owner() is the exception: 25 RLS policies call it as the logged-in
--      user, so authenticated (and service_role) get it back explicitly.
--   3. The two updated_at trigger functions get a fixed search_path.
--
-- If stage 1 (20261017221826) runs AFTER this, run this again: it creates
-- guard_quote_line_prices() with the default grants.

set local lock_timeout = '5s';

-- ── 1. The Make.com webhook ─────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_trigger
              where tgrelid = 'public.quote_requests'::regclass and tgname = 'send_to_make') then
    alter table public.quote_requests disable trigger send_to_make;
  end if;
end $$;

-- ── 2. Definer functions ────────────────────────────────────────────────────
revoke execute on function public.guard_payment_not_over_total() from public;
revoke execute on function public.guard_quote_money_columns() from public;
revoke execute on function public.handle_new_user() from public;

revoke execute on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated, service_role;

-- Stage 1's line-price guard, when it is there.
do $$
begin
  if to_regprocedure('public.guard_quote_line_prices()') is not null then
    revoke execute on function public.guard_quote_line_prices() from public, anon, authenticated;
  end if;
end $$;

-- ── 3. search_path ──────────────────────────────────────────────────────────
alter function public.touch_updated_at() set search_path = public, pg_temp;
alter function public.touch_agreements_updated_at() set search_path = public, pg_temp;
