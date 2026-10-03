-- Raleigh Concrete Group - a change request can ask for a second deposit
-- Run this AFTER change-order-lines.sql. Safe to re-run.
--
-- A change that adds materials usually needs money up front to buy them. Dave's
-- patio grew by $1,390 of materials: he sends that now, and the rest is paid
-- when the work is done, like the rest of the job.
--
-- Two columns, both whole cents:
--
--   change_deposit_cents   rides on a pending change, like change_amount. What
--                          the crew asked to be paid up front if the customer
--                          approves. Null when the change asks for nothing.
--
--   deposit_target_cents   on the job, once a change with a deposit is
--                          approved: how much the customer should have paid IN
--                          TOTAL before the work goes ahead. Set to "what they
--                          had paid when they approved" plus the deposit.
--
-- "Due now" is then target minus paid, never below zero and never more than the
-- balance. Stored as a target rather than as "$1,390 owed" so it clears itself:
-- record Dave's check and it reads zero, with nothing to remember to switch off.

alter table public.quote_requests
  add column if not exists change_deposit_cents integer,
  add column if not exists deposit_target_cents integer;

alter table public.quote_requests drop constraint if exists quote_requests_change_deposit_sane;
alter table public.quote_requests add constraint quote_requests_change_deposit_sane check (
  change_deposit_cents is null
  or (change_requested_at is not null and change_deposit_cents > 0 and change_deposit_cents <= 9999999999)
);

alter table public.quote_requests drop constraint if exists quote_requests_deposit_target_sane;
alter table public.quote_requests add constraint quote_requests_deposit_target_sane check (
  deposit_target_cents is null or (deposit_target_cents >= 0 and deposit_target_cents <= 9999999999)
);

-- Same function as change-order-lines.sql, plus the deposit: approving a change
-- that asks for one sets the job's target; either answer clears the request.
create or replace function public.apply_change_response(p_id uuid, p_accept boolean)
returns jsonb language plpgsql security definer set search_path = public
as $fn$
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
  -- What they had paid at the moment they approved, read the same way the app's
  -- ledger reads it: settled rows, net of refunds.
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
$fn$;
revoke all on function public.apply_change_response(uuid, boolean) from public;
revoke all on function public.apply_change_response(uuid, boolean) from anon, authenticated;
grant execute on function public.apply_change_response(uuid, boolean) to service_role;
notify pgrst, 'reload schema';
