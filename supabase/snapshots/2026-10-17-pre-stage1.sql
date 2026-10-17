-- Raleigh Concrete Group - snapshot of the LIVE database before stage 1
-- (price lockdown), read on 2026-10-17 from the production project.
--
-- REFERENCE ONLY. Do not run this file. It is what the catalog said at the
-- time, written down so stage 1 can be reviewed against reality rather than
-- against the files in supabase/ (which had drifted: the live guard function
-- is the fee-waiver.sql version, not the least-privilege.sql one), and so
-- supabase/stage1-price-lockdown.undo.sql has an exact target to restore.
--
-- How it was read: read-only catalog queries only - information_schema.columns,
-- pg_policies, pg_trigger + pg_get_triggerdef, pg_proc + pg_get_functiondef,
-- pg_constraint, pg_class.relacl, information_schema.role_table_grants and
-- column_privileges. No table rows were selected.
--
-- Server: PostgreSQL 17.6.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Columns on public.quote_requests (ordinal order)
-- ════════════════════════════════════════════════════════════════════════════
--   1 id                      uuid         not null default gen_random_uuid()
--   2 created_at              timestamptz  not null default now()
--   3 name                    text         not null
--   4 phone                   text         not null
--   5 email                   text
--   6 service                 text
--   7 address                 text
--   8 city                    text
--   9 details                 text
--  10 quote_type              text
--  11 preferred_time          text
--  12 file_urls               jsonb
--  13 source_path             text
--  14 status                  text         not null default 'new'
--  15 assigned_to             uuid
--  16 quote_amount            numeric
--  17 quote_summary           text
--  18 internal_notes          text
--  19 public_token            text         default replace(gen_random_uuid()::text, '-', '')
--  20 job_token               text         default replace(gen_random_uuid()::text, '-', '')
--  21 viewed_at               timestamptz
--  22 view_count              integer      not null default 0
--  23 quote_sent_at           timestamptz
--  24 updated_at              timestamptz  not null default now()
--  25 customer_response       text
--  26 customer_responded_at   timestamptz
--  27 scheduled_date          date
--  28 discount_accepted       boolean      not null default false
--  29 visit_date              date
--  30 visit_time              text
--  31 gcal_event_id           text
--  32 reminder_sent_at        timestamptz
--  33 confirmed_at            timestamptz
--  34 completed_at            timestamptz
--  35 paid_at                 timestamptz
--  36 payment_requested_at    timestamptz
--  37 archived_at             timestamptz
--  38 preferred_dates         ARRAY
--  39 scheduled_by            uuid
--  40 scheduled_at            timestamptz
--  41 scheduled_time          text
--  42 crew_reminders          ARRAY
--  43 stale_lead_reminded_at  timestamptz
--  44 visit_reminder_sent_at  timestamptz
--  45 visit_crew_reminded_at  timestamptz
--  46 quote_followup_sent_at  timestamptz
--  47 quote_scope             text
--  48 quote_permits           text
--  49 quote_prep              text
--  50 quote_pour              text
--  51 quote_cleanup           text
--  52 quote_expires_at        timestamptz
--  53 internal_urls           ARRAY
--  54 before_urls             ARRAY
--  55 after_urls              ARRAY
--  56 preferred_times         ARRAY
--  57 fee_rate                numeric
--  58 fee_total_cents         integer
--  59 is_test                 boolean      not null default false
--  60 client_submission_id    text
--  61 change_note             text
--  62 change_amount           numeric
--  63 change_requested_at     timestamptz
--  64 change_requested_by     uuid
--  65 change_lines            jsonb
--  66 change_deposit_cents    integer
--  67 deposit_target_cents    integer
--  68 fee_waived_cents        integer      not null default 0
--  69 fee_waived_note         text
--
-- public.quote_options:  id uuid, quote_id uuid, title text, description text,
--   amount numeric not null default 0, required boolean not null default false,
--   sort_order integer not null default 0, customer_response text,
--   responded_at timestamptz, created_at timestamptz, updated_at timestamptz
-- public.quote_packages: id uuid, quote_id uuid, title text, description text,
--   amount numeric not null default 0, recommended boolean not null default false,
--   sort_order integer not null default 0, customer_response text,
--   responded_at timestamptz, created_at timestamptz, updated_at timestamptz

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Check constraints on public.quote_requests
-- ════════════════════════════════════════════════════════════════════════════
-- qr_customer_response_chk: CHECK (customer_response IS NULL OR customer_response = ANY (ARRAY['accepted','declined']))
-- qr_status_chk:            CHECK (status = ANY (ARRAY['new','quoted','approved','scheduled','completed','paid','lost']))
-- quote_requests_change_amount_sane:   CHECK (change_amount IS NULL OR (change_amount >= 0 AND change_amount <= 99999999))
-- quote_requests_change_complete:      CHECK ((change_requested_at IS NULL AND change_amount IS NULL AND change_note IS NULL)
--                                          OR (change_requested_at IS NOT NULL AND change_amount IS NOT NULL AND change_note IS NOT NULL))
-- quote_requests_change_deposit_sane:  CHECK (change_deposit_cents IS NULL OR (change_requested_at IS NOT NULL AND change_deposit_cents > 0 AND change_deposit_cents <= 9999999999))
-- quote_requests_change_lines_sane:    CHECK (change_lines IS NULL OR (change_requested_at IS NOT NULL AND jsonb_typeof(change_lines) = 'array' AND jsonb_array_length(change_lines) <= 12))
-- quote_requests_deposit_target_sane:  CHECK (deposit_target_cents IS NULL OR (deposit_target_cents >= 0 AND deposit_target_cents <= 9999999999))
-- quote_requests_fee_waived_sane:      CHECK (fee_waived_cents >= 0 AND fee_waived_cents <= 9999999999)
-- (plus qr_chk and qr_sections_chk: text length / shape checks, nothing money related)

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Row level security
-- ════════════════════════════════════════════════════════════════════════════
-- RLS enabled (not forced) on quote_requests, quote_options, quote_packages,
-- quote_payments, fee_settlements.

-- quote_requests
create policy "contractor updates assigned" on public.quote_requests
  as permissive for update to authenticated
  using ((assigned_to = auth.uid()))
  with check ((assigned_to = auth.uid()));
create policy "owner inserts quotes" on public.quote_requests
  as permissive for insert to authenticated
  with check (is_owner());
create policy "owner updates quotes" on public.quote_requests
  as permissive for update to authenticated
  using (is_owner())
  with check (is_owner());
create policy "staff read quotes" on public.quote_requests
  as permissive for select to authenticated
  using ((is_owner() OR ((assigned_to = auth.uid()) AND (status <> 'lost'::text) AND (archived_at IS NULL))));

-- quote_options (packages are identical with quote_packages in place of quote_options)
create policy "staff delete options" on public.quote_options
  as permissive for delete to authenticated
  using ((is_owner() OR (EXISTS ( SELECT 1 FROM quote_requests q
    WHERE ((q.id = quote_options.quote_id) AND (q.assigned_to = auth.uid()))))));
create policy "staff insert options" on public.quote_options
  as permissive for insert to authenticated
  with check ((is_owner() OR (EXISTS ( SELECT 1 FROM quote_requests q
    WHERE ((q.id = quote_options.quote_id) AND (q.assigned_to = auth.uid()))))));
create policy "staff read options" on public.quote_options
  as permissive for select to authenticated
  using ((is_owner() OR (EXISTS ( SELECT 1 FROM quote_requests q
    WHERE ((q.id = quote_options.quote_id) AND (q.assigned_to = auth.uid()))))));
create policy "staff update options" on public.quote_options
  as permissive for update to authenticated
  using ((is_owner() OR (EXISTS ( SELECT 1 FROM quote_requests q
    WHERE ((q.id = quote_options.quote_id) AND (q.assigned_to = auth.uid()))))))
  with check ((is_owner() OR (EXISTS ( SELECT 1 FROM quote_requests q
    WHERE ((q.id = quote_options.quote_id) AND (q.assigned_to = auth.uid()))))));
-- quote_packages: "staff delete packages", "staff insert packages",
-- "staff read packages", "staff update packages" - same expressions as above.

-- quote_payments
create policy "staff insert payments" on public.quote_payments
  as permissive for insert to authenticated
  with check (((is_owner() OR (EXISTS ( SELECT 1 FROM quote_requests q
    WHERE ((q.id = quote_payments.quote_id) AND (q.assigned_to = auth.uid())))))
    AND (method <> 'card'::text) AND (fee_cents = 0) AND (status = 'paid'::text)
    AND (recorded_by = auth.uid()) AND (stripe_account_id IS NULL)
    AND (checkout_session_id IS NULL) AND (payment_intent_id IS NULL)
    AND (refunded_cents = 0)));
create policy "staff read payments" on public.quote_payments
  as permissive for select to authenticated
  using ((is_owner() OR (EXISTS ( SELECT 1 FROM quote_requests q
    WHERE ((q.id = quote_payments.quote_id) AND (q.assigned_to = auth.uid()))))));

-- fee_settlements
create policy "owner insert settlements" on public.fee_settlements
  as permissive for insert to authenticated with check (is_owner());
create policy "owner read settlements" on public.fee_settlements
  as permissive for select to authenticated using (is_owner());

-- quote_events
create policy "staff insert events" on public.quote_events
  as permissive for insert to authenticated
  with check ((is_owner() OR (EXISTS ( SELECT 1 FROM quote_requests q
    WHERE ((q.id = quote_events.quote_id) AND (q.assigned_to = auth.uid()))))));
create policy "staff read events" on public.quote_events
  as permissive for select to authenticated
  using ((is_owner() OR (EXISTS ( SELECT 1 FROM quote_requests q
    WHERE ((q.id = quote_events.quote_id) AND (q.assigned_to = auth.uid()))))));

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Grants (pg_class.relacl)
-- ════════════════════════════════════════════════════════════════════════════
-- quote_requests:  postgres=arwdDxtm  authenticated=arwDxtm  service_role=arwDxtm   (no anon)
-- quote_options:   postgres=arwdDxtm  anon=Dxtm  authenticated=arwdDxtm  service_role=arwdDxtm
-- quote_packages:  postgres=arwdDxtm  anon=Dxtm  authenticated=arwdDxtm  service_role=arwdDxtm
-- quote_payments:  postgres=arwdDxtm  anon=Dxtm  authenticated=arDxtm    service_role=arwdDxtm
-- fee_settlements: postgres=arwdDxtm  anon=Dxtm  authenticated=arDxtm    service_role=arwdDxtm
-- (a=insert r=select w=update d=delete D=truncate x=references t=trigger m=maintain)
-- No column-level grants: column_privileges mirrors the table grants on every
-- column (quote_requests: 69 columns each for INSERT/SELECT/UPDATE/REFERENCES
-- to authenticated and service_role).
--
-- Function ACLs: apply_change_response = {postgres=X, service_role=X} (not
-- executable by anon/authenticated). guard_quote_money_columns, is_owner,
-- touch_updated_at, guard_payment_not_over_total = default (PUBLIC execute).

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Triggers
-- ════════════════════════════════════════════════════════════════════════════
CREATE TRIGGER qo_touch_updated_at BEFORE UPDATE ON public.quote_options FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER qp_touch_updated_at BEFORE UPDATE ON public.quote_packages FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER qp_guard_over_total BEFORE INSERT ON public.quote_payments FOR EACH ROW EXECUTE FUNCTION guard_payment_not_over_total();
CREATE TRIGGER qr_guard_money_columns BEFORE UPDATE ON public.quote_requests FOR EACH ROW EXECUTE FUNCTION guard_quote_money_columns();
CREATE TRIGGER qr_touch_updated_at BEFORE UPDATE ON public.quote_requests FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
-- Also on quote_requests: send_to_make, AFTER INSERT, an outbound webhook
-- (supabase_functions.http_request). Not touched by stage 1; the URL is left
-- out of this file on purpose.

-- ════════════════════════════════════════════════════════════════════════════
-- 6. Functions (pg_get_functiondef, verbatim). All owned by postgres.
-- ════════════════════════════════════════════════════════════════════════════

-- The guard stage 1 replaces. SECURITY DEFINER, search_path = public.
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

-- The owner helper the guard relies on (body has CRLF line endings live).
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

CREATE OR REPLACE FUNCTION public.touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

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

-- The only thing that moves the price of an agreed job. Service role only.
-- Re-read before the change-order follow-up (stage1-price-lockdown.sql section
-- 3 replaces it): md5 of pg_get_functiondef identical to the text below, one
-- overload only, ACL {postgres=X/postgres,service_role=X/postgres}.
CREATE OR REPLACE FUNCTION public.apply_change_response(p_id uuid, p_accept boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  q public.quote_requests;
  v_from numeric; v_to numeric; v_note text; v_lines jsonb; v_old jsonb; v_sum numeric;
  v_deposit integer; v_paid bigint;
begin
  select * into q from public.quote_requests where id = p_id for update;
  if not found or q.change_requested_at is null or q.change_amount is null then
    return jsonb_build_object('status', 'none');
  end if;
  v_from := q.quote_amount; v_to := q.change_amount; v_note := q.change_note; v_lines := q.change_lines;
  v_deposit := q.change_deposit_cents;
  select coalesce(jsonb_agg(jsonb_build_object('title', o.title, 'description', o.description, 'amount', o.amount,
           'required', o.required, 'customer_response', o.customer_response) order by o.sort_order, o.created_at), '[]'::jsonb)
    into v_old from public.quote_options o where o.quote_id = p_id;
  if p_accept and v_lines is not null then
    if jsonb_array_length(v_lines) > 0 then
      select coalesce(sum((l->>'amount')::numeric), 0) into v_sum from jsonb_array_elements(v_lines) l;
      if round(v_sum, 2) <> round(v_to, 2) then
        raise exception 'change lines (%) do not add up to the new total (%)', v_sum, v_to;
      end if;
    end if;
    delete from public.quote_options where quote_id = p_id;
    insert into public.quote_options (quote_id, title, description, amount, required, sort_order, customer_response, responded_at)
    select p_id, l->>'title', nullif(l->>'description', ''), (l->>'amount')::numeric, true, (t.ord - 1)::int, 'accepted', now()
    from jsonb_array_elements(v_lines) with ordinality as t(l, ord);
  end if;
  select coalesce(sum(p.amount_cents - p.refunded_cents), 0) into v_paid
    from public.quote_payments p where p.quote_id = p_id and p.status in ('paid', 'refunded');
  update public.quote_requests set
    quote_amount = case when p_accept then v_to else quote_amount end,
    deposit_target_cents = case when p_accept and v_deposit is not null then (v_paid + v_deposit)::int else deposit_target_cents end,
    change_note = null, change_amount = null, change_requested_at = null, change_requested_by = null,
    change_lines = null, change_deposit_cents = null
  where id = p_id returning * into q;
  return jsonb_build_object('status', 'ok', 'quote', to_jsonb(q), 'from', v_from, 'to', v_to, 'note', v_note,
    'old_lines', v_old, 'new_lines', v_lines, 'deposit_cents', case when p_accept then v_deposit else null end,
    'paid_cents', v_paid);
end;
$function$;

-- auth.uid() as installed (what "auth.uid() is null" means for the exemption):
--   select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
--                   (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
-- The service-role key carries no sub, so it reads as null.
