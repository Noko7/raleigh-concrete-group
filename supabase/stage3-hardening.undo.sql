-- Raleigh Concrete Group - undo stage 3 (hardening)
-- Puts the database back as it was read on 2026-10-17, before
-- stage3-hardening.sql ran. See supabase/snapshots/2026-10-17-pre-stage3.sql.
-- Safe to re-run.
--
--   1. send_to_make comes back, identical to the live pg_get_triggerdef, but
--      only once the webhook URL is pasted in below. It is a credential and is
--      not committed; until it is there this step is skipped with a NOTICE, so a
--      trigger never posts every new lead to a placeholder.
--   2. The definer functions get EXECUTE for PUBLIC back. Their ACL was NULL
--      (the built-in default); a GRANT can only write that default out, as
--      {=X/postgres,postgres=X/postgres}, which grants exactly the same.
--      is_owner()'s explicit authenticated and service_role grants are removed.
--   3. touch_updated_at() and touch_agreements_updated_at() lose search_path
--      again (proconfig NULL).

begin;

-- ── 1. The Make.com webhook ─────────────────────────────────────────────────
do $$
declare
  -- The real value is in the Supabase dashboard (Database -> Webhooks / history).
  url text := '<MAKE_WEBHOOK_URL - see Supabase dashboard history>';
begin
  if url like '<%' then
    raise notice 'send_to_make not restored: paste the Make.com webhook URL into stage3-hardening.undo.sql';
  elsif not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.quote_requests'::regclass and tgname = 'send_to_make'
  ) then
    execute format(
      'create trigger send_to_make after insert on public.quote_requests for each row '
      'execute function supabase_functions.http_request(%L, %L, %L, %L, %L)',
      url, 'POST', '{"Content-type":"application/json"}', '{}', '5000'
    );
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
