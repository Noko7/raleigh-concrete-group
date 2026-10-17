-- Raleigh Concrete Group - undo stage 1 (price lockdown)
-- Puts the database back exactly as it was read on 2026-10-17, before
-- migrations/20261017221826_stage1_price_lockdown.sql ran. See supabase/snapshots/2026-10-17-pre-stage1.sql
-- for the definitions this restores. Safe to re-run.
--
-- What it does:
--   1. guard_quote_money_columns() gets its pre-stage-1 body back, verbatim -
--      the fee-waiver.sql version, including its `search_path TO 'public'`.
--      The trigger that calls it (qr_guard_money_columns) was never removed,
--      only re-created identically, so it is re-created identically here too.
--   2. The line-price guard did not exist before stage 1, so its two triggers
--      and its function are dropped.
--   3. apply_change_response goes back to its two-argument form (the original,
--      kept as apply_change_response_core while stage 1 was live), with
--      its grants as they were (postgres and service_role only). The app still
--      works against it: it retries without p_requested_at when the database
--      does not know that argument, so only the stale-page check is lost.
--
-- Nothing else was changed by stage 1: no policy, table grant, column,
-- constraint or other trigger.

begin;

-- ── 1. quote_requests: the guard as it was ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_quote_money_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null or public.is_owner() then
    return new;
  end if;

  if new.fee_rate is distinct from old.fee_rate
     or new.fee_total_cents is distinct from old.fee_total_cents
     or new.fee_waived_cents is distinct from old.fee_waived_cents
     or new.fee_waived_note is distinct from old.fee_waived_note then
    raise exception 'the office fee is set by the office'
      using errcode = '42501';
  end if;

  if new.is_test is distinct from old.is_test then
    raise exception 'is_test is set by the office' using errcode = '42501';
  end if;

  if new.archived_at is distinct from old.archived_at then
    raise exception 'archiving a lead is done by the office' using errcode = '42501';
  end if;

  return new;
end;
$function$;

drop trigger if exists qr_guard_money_columns on public.quote_requests;
CREATE TRIGGER qr_guard_money_columns BEFORE UPDATE ON public.quote_requests FOR EACH ROW EXECUTE FUNCTION guard_quote_money_columns();

-- ── 2. quote_options / quote_packages: no line-price guard ──────────────────
drop trigger if exists qo_guard_line_prices on public.quote_options;
drop trigger if exists qp_guard_line_prices on public.quote_packages;
drop function if exists public.guard_quote_line_prices();

-- ── 3. apply_change_response as it was ──────────────────────────────────────
-- Stage 1 renamed the live function to apply_change_response_core, verbatim,
-- and put a three-argument wrapper in its place. Remove the wrapper and give
-- the original back its name and grants.
drop function if exists public.apply_change_response(uuid, boolean, timestamptz);
alter function public.apply_change_response_core(uuid, boolean) rename to apply_change_response;
revoke all on function public.apply_change_response(uuid, boolean) from public, anon, authenticated;
grant execute on function public.apply_change_response(uuid, boolean) to service_role;

commit;

notify pgrst, 'reload schema';
