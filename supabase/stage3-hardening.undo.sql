-- Raleigh Concrete Group - undo stage 3 (hardening)
-- Puts the database back as it was read on 2026-10-17, before
-- stage3-hardening.sql ran. See supabase/snapshots/2026-10-17-pre-stage3.sql.
-- Safe to re-run.
--
--   1. send_to_make is enabled again (stage 3 only disabled it).
--   2. The definer functions get EXECUTE for PUBLIC back. Their ACL was NULL
--      (the built-in default); a GRANT can only write that default out, as
--      {=X/postgres,postgres=X/postgres}, which grants exactly the same.
--      is_owner()'s explicit authenticated and service_role grants are removed.
--   3. touch_updated_at() and touch_agreements_updated_at() lose search_path
--      again (proconfig NULL).

begin;

-- ── 1. The Make.com webhook ─────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_trigger
              where tgrelid = 'public.quote_requests'::regclass and tgname = 'send_to_make') then
    alter table public.quote_requests enable trigger send_to_make;
  end if;
end $$;

-- ── 2. Definer functions ────────────────────────────────────────────────────
grant execute on function public.guard_payment_not_over_total() to public;
grant execute on function public.guard_quote_money_columns() to public;
grant execute on function public.handle_new_user() to public;

revoke execute on function public.is_owner() from authenticated, service_role;
grant execute on function public.is_owner() to public;

do $$
begin
  if to_regprocedure('public.guard_quote_line_prices()') is not null then
    grant execute on function public.guard_quote_line_prices() to public;
  end if;
end $$;

-- ── 3. search_path ──────────────────────────────────────────────────────────
alter function public.touch_updated_at() reset search_path;
alter function public.touch_agreements_updated_at() reset search_path;

commit;
