-- Raleigh Concrete Group - snapshot of the LIVE database before stage 3
-- (hardening), read on 2026-10-17 from the production project.
--
-- REFERENCE ONLY. Do not run this file. It is what the catalog said at the
-- time, so supabase/stage3-hardening.undo.sql has an exact target to restore.
--
-- How it was read: read-only catalog queries only - pg_proc (proacl,
-- proconfig, prosecdef) + pg_get_functiondef, pg_trigger + pg_get_triggerdef,
-- pg_policies, pg_constraint, pg_default_acl. No table rows were selected.
--
-- Server: PostgreSQL 17.6.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. ACLs and settings of the functions stage 3 touches
-- ════════════════════════════════════════════════════════════════════════════
-- proacl NULL is the built-in default: EXECUTE for PUBLIC (so anon and
-- authenticated too, through the REST API) plus the owner.
--
--   function                         owner     definer  proacl  proconfig
--   guard_payment_not_over_total()   postgres  yes      NULL    {search_path=public}
--   guard_quote_money_columns()      postgres  yes      NULL    {search_path=public}
--   handle_new_user()                postgres  yes      NULL    {search_path=public}
--   is_owner()                       postgres  yes      NULL    {search_path=public}
--   touch_updated_at()               postgres  no       NULL    NULL
--   touch_agreements_updated_at()    postgres  no       NULL    NULL
--   guard_quote_line_prices()        (absent: stage1-price-lockdown.sql not run yet)
--
-- has_function_privilege('anon', 'public.is_owner()', 'execute')                 = true
-- has_function_privilege('authenticated', 'public.handle_new_user()', 'execute') = true
--
-- Default privileges for functions postgres creates in public:
--   pg_default_acl (postgres, public, f) = {postgres=X/postgres}
-- That entry is added to the built-in default rather than replacing it, so a
-- function created now still gets EXECUTE for PUBLIC, just written out.

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Function definitions (pg_get_functiondef, verbatim except that the live
--    bodies of all but guard_quote_money_columns use CRLF line endings, written here as LF)
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.guard_payment_not_over_total()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  total_cents  integer;
  already_cents integer;
begin
  if auth.uid() is null or new.status <> 'paid' then
    return new;
  end if;

  select round(coalesce(q.quote_amount, 0) * 100)::integer
    into total_cents
    from public.quote_requests q
   where q.id = new.quote_id;

  -- No price on the job yet: the app refuses this case with a better message,
  -- and there is no total here to measure an overpayment against.
  if total_cents is null or total_cents <= 0 then
    return new;
  end if;

  select coalesce(sum(p.amount_cents - p.refunded_cents), 0)
    into already_cents
    from public.quote_payments p
   where p.quote_id = new.quote_id
     and p.status in ('paid', 'refunded');

  if already_cents + new.amount_cents > total_cents then
    raise exception 'that is more than the % cents still owed on this job',
      greatest(total_cents - already_cents, 0)
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

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

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.staff (id, email, full_name, role, active)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''), 'contractor', false)
  on conflict (id) do nothing;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.is_owner()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.staff s
    where s.id = auth.uid() and s.role = 'owner' and s.active
  );
$function$;

CREATE OR REPLACE FUNCTION public.touch_agreements_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Triggers that call them, and the Make.com webhook (all enabled, 'O')
-- ════════════════════════════════════════════════════════════════════════════
--   auth.users            on_auth_user_created       -> handle_new_user()
--   quote_requests        qr_guard_money_columns     -> guard_quote_money_columns()
--   quote_requests        qr_touch_updated_at        -> touch_updated_at()
--   quote_options         qo_touch_updated_at        -> touch_updated_at()
--   quote_packages        qp_touch_updated_at        -> touch_updated_at()
--   quote_payments        qp_guard_over_total        -> guard_payment_not_over_total()
--   agreements            agreements_touch_updated_at -> touch_agreements_updated_at()
--   quote_requests        send_to_make               -> supabase_functions.http_request(...)
--
-- send_to_make, from pg_get_triggerdef. The webhook URL is REDACTED here and in
-- every committed file: it is a live credential for the Make.com scenario. The
-- real value is in the Supabase dashboard (Database -> Webhooks, or the trigger's
-- history); md5 of the full live triggerdef = 2fe9550db81196da83dc42cbac03b357,
-- length 250 characters. No comment on the trigger.
--
-- CREATE TRIGGER send_to_make AFTER INSERT ON public.quote_requests FOR EACH ROW
--   EXECUTE FUNCTION supabase_functions.http_request('<MAKE_WEBHOOK_URL - see Supabase dashboard history>',
--   'POST', '{"Content-type":"application/json"}', '{}', '5000')

-- ════════════════════════════════════════════════════════════════════════════
-- 4. What depends on is_owner()
-- ════════════════════════════════════════════════════════════════════════════
-- 25 of the 26 RLS policies, every one of them TO authenticated (none for anon
-- or public), plus guard_quote_money_columns() (a definer, so it calls it as
-- postgres). No view or other function references it.
--
--   agreements          owner writes agreements, staff read agreements
--   contractor_invites  owner reads invites
--   fee_settlements     owner insert settlements, owner read settlements
--   job_staff_views     owner reads crew views
--   login_attempts      owner reads login attempts
--   quote_events        staff insert events, staff read events
--   quote_messages      staff read messages
--   quote_options       staff delete/insert/read/update options
--   quote_packages      staff delete/insert/read/update packages
--   quote_payments      staff insert payments, staff read payments
--   quote_requests      owner inserts quotes, owner updates quotes, staff read quotes
--   staff               owner manages staff, staff self or owner read

-- ════════════════════════════════════════════════════════════════════════════
-- 5. staff and auth.users (for the contractor-join race fix)
-- ════════════════════════════════════════════════════════════════════════════
-- staff_id_fkey: FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE
-- So deleting the auth user removes the inactive staff row handle_new_user()
-- made. Every FK into staff is ON DELETE CASCADE or SET NULL (none RESTRICT),
-- including contractor_invites_used_by_fkey (SET NULL). No triggers on staff.
