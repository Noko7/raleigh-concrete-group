-- Raleigh Concrete Group - stage 3: database hygiene
-- Run once in Supabase -> SQL Editor. Safe to re-run. Undo: stage3-hardening.undo.sql.
-- The state it was written against: supabase/snapshots/2026-10-17-pre-stage3.sql.
--
--   1. The Make.com webhook trigger on new leads goes. Nothing uses the scenario
--      any more, and every lead insert was posting the whole row to it.
--   2. SECURITY DEFINER functions stop being callable by anyone through the REST
--      API. Their EXECUTE came from the built-in PUBLIC grant (proacl NULL), so
--      revoking from anon or authenticated alone changes nothing: it has to come
--      off PUBLIC. A trigger function needs no EXECUTE to fire - that is only
--      checked when the trigger is created - so the guards keep running.
--      is_owner() is the exception: 25 RLS policies call it as the logged-in
--      user, so authenticated (and service_role) get it back explicitly.
--   3. The two updated_at trigger functions get a fixed search_path.
--
-- If stage1-price-lockdown.sql runs AFTER this, run this again: it creates
-- guard_quote_line_prices() with the default grants.

begin;

-- ── 1. The Make.com webhook ─────────────────────────────────────────────────
drop trigger if exists send_to_make on public.quote_requests;

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

commit;
