-- Raleigh Concrete Group - undo stage 1 (price lockdown)
-- Puts the database back exactly as it was read on 2026-10-17, before
-- stage1-price-lockdown.sql ran. See supabase/snapshots/2026-10-17-pre-stage1.sql
-- for the definitions this restores. Safe to re-run.
--
-- What it does:
--   1. guard_quote_money_columns() gets its pre-stage-1 body back, verbatim -
--      the fee-waiver.sql version, including its `search_path TO 'public'`.
--      The trigger that calls it (qr_guard_money_columns) was never removed,
--      only re-created identically, so it is re-created identically here too.
--   2. The line-price guard did not exist before stage 1, so its two triggers
--      and its function are dropped.
--   3. apply_change_response goes back to its two-argument form, verbatim, with
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
drop function if exists public.apply_change_response(uuid, boolean, timestamptz);

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

revoke all on function public.apply_change_response(uuid, boolean) from public, anon, authenticated;
grant execute on function public.apply_change_response(uuid, boolean) to service_role;

commit;

notify pgrst, 'reload schema';
