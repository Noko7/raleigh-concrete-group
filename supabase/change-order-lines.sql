-- Raleigh Concrete Group - a change order can carry its own price breakdown
-- Run this AFTER change-orders.sql and quote-options.sql. Safe to re-run.
--
-- A customer asking for a change on a booked job usually asks a second question
-- straight after: "so what does that come to, and where does it go?" A change
-- order used to answer with one new total. Now it can carry the lines behind
-- it (materials, labor, and so on), the same way a quote can.
--
-- change_lines is the proposed breakdown, held next to change_amount until the
-- customer answers:
--   null   the change does not touch the breakdown (a job priced as one figure,
--          changed to another figure)
--   [...]  the job's breakdown once they approve. Replaces the line items on
--          the job. An empty array means "this job goes back to one price".
--
-- Nothing moves until they approve. Approving is one transaction in
-- apply_change_response below: the line items, the price and the cleared
-- change all land together or not at all, so the job can never show a new
-- breakdown against an old total.

alter table public.quote_requests
  add column if not exists change_lines jsonb;

-- Lines only ever ride on a pending change, and are a short list.
alter table public.quote_requests drop constraint if exists quote_requests_change_lines_sane;
alter table public.quote_requests add constraint quote_requests_change_lines_sane check (
  change_lines is null
  or (
    change_requested_at is not null
    and jsonb_typeof(change_lines) = 'array'
    and jsonb_array_length(change_lines) <= 12
  )
);

-- The customer's answer, applied in one go. Service role only: the customer
-- page has no session, and the unguessable link is checked by the server
-- before this is called.
--
-- Returns what happened, so the caller can log it and text the crew:
--   status     'ok', or 'none' when nothing was waiting (a second tap)
--   quote      the job as it now stands
--   from / to  the total before and after (to is the proposed total either way)
--   note       what the change said
--   old_lines / new_lines  the breakdown before and after, for the activity log
create or replace function public.apply_change_response(p_id uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  q public.quote_requests;
  v_from numeric;
  v_to numeric;
  v_note text;
  v_lines jsonb;
  v_old jsonb;
  v_sum numeric;
begin
  -- Locked, so a double tap waits for the first to finish and then sees that
  -- there is nothing left to answer.
  select * into q from public.quote_requests where id = p_id for update;
  if not found or q.change_requested_at is null or q.change_amount is null then
    return jsonb_build_object('status', 'none');
  end if;

  v_from := q.quote_amount;
  v_to := q.change_amount;
  v_note := q.change_note;
  v_lines := q.change_lines;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'title', o.title,
        'description', o.description,
        'amount', o.amount,
        'required', o.required,
        'customer_response', o.customer_response
      )
      order by o.sort_order, o.created_at
    ),
    '[]'::jsonb
  )
  into v_old
  from public.quote_options o
  where o.quote_id = p_id;

  if p_accept and v_lines is not null then
    -- The lines must add up to the total the customer was shown. The server
    -- writes them that way; this is the backstop that keeps a breakdown and a
    -- price from ever disagreeing on a job.
    if jsonb_array_length(v_lines) > 0 then
      select coalesce(sum((l->>'amount')::numeric), 0) into v_sum
      from jsonb_array_elements(v_lines) l;
      if round(v_sum, 2) <> round(v_to, 2) then
        raise exception 'change lines (%) do not add up to the new total (%)', v_sum, v_to;
      end if;
    end if;

    delete from public.quote_options where quote_id = p_id;

    -- Every line is part of the job and already agreed: the customer approved
    -- this exact list a moment ago.
    insert into public.quote_options
      (quote_id, title, description, amount, required, sort_order, customer_response, responded_at)
    select
      p_id,
      l->>'title',
      nullif(l->>'description', ''),
      (l->>'amount')::numeric,
      true,
      (t.ord - 1)::int,
      'accepted',
      now()
    from jsonb_array_elements(v_lines) with ordinality as t(l, ord);
  end if;

  update public.quote_requests
  set
    quote_amount = case when p_accept then v_to else quote_amount end,
    change_note = null,
    change_amount = null,
    change_requested_at = null,
    change_requested_by = null,
    change_lines = null
  where id = p_id
  returning * into q;

  return jsonb_build_object(
    'status', 'ok',
    'quote', to_jsonb(q),
    'from', v_from,
    'to', v_to,
    'note', v_note,
    'old_lines', v_old,
    'new_lines', v_lines
  );
end;
$$;

revoke all on function public.apply_change_response(uuid, boolean) from public;
revoke all on function public.apply_change_response(uuid, boolean) from anon, authenticated;
grant execute on function public.apply_change_response(uuid, boolean) to service_role;
