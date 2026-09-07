-- Raleigh Concrete Group - least privilege on the money columns
-- Run this AFTER crm.sql and payments.sql, once, in Supabase -> SQL Editor.
-- Safe to re-run.
--
-- Why this file exists.
--
-- A contractor does not only reach this database through the CRM. The project
-- URL and the anon key are both public (the browser needs them), and a
-- contractor knows their own email and password - so they can mint their own
-- access token against Supabase Auth and talk to PostgREST directly. Whatever
-- RLS allows, they can do, with curl, regardless of what the screens offer.
--
-- Read that way, two grants were doing far more than the app ever asked of
-- them:
--
--   1. "contractor updates assigned" on quote_requests is a TABLE-wide update.
--      fee_rate and fee_total_cents live on that table, and the fee is frozen
--      on the row the first time money moves. Setting fee_rate to 0 on your own
--      job makes the office earn nothing on it, permanently and silently:
--      ensureFeeOnJob keeps a rate that is already set, readLedger re-derives
--      the fee from it, and the cash board only flags a MISSING rate, not a
--      zero one. is_test hides the job from every figure on that board, and
--      archived_at hides it from the pipeline.
--
--   2. quote_payments granted insert AND update to authenticated. The app never
--      updates that table as a user - markSessionPaid, applyRefund and
--      expireStalePending all go through the service role - so the update grant
--      was pure attack surface: rewriting fee_cents on a paid row moves what
--      you owe the office to zero. The insert grant was shaped for the form
--      that uses it but not enforced, so a hand-rolled insert could claim a
--      card payment that never happened.
--
-- payments.sql already states the principle for fee_settlements: "a contractor
-- being able to write 'I paid the office' would make the board they are settled
-- from worthless." The same sentence applies to every number that board is a
-- sum of. This file finishes the job.
--
-- Nothing here changes what the app can do. Every write the CRM performs was
-- checked against these rules first; the service role is deliberately exempt,
-- because that is the key the server's own code holds and it has already done
-- its own authorization by the time it gets here.

-- Self-sufficient on purpose. The four columns guarded below arrive with
-- payments.sql (the fee pair) and test-data.sql (is_test), and a plpgsql
-- trigger that names a column the table does not have fails at RUN time, not
-- at create time - which would turn "I ran the files in the wrong order" into
-- "every CRM save is broken". These are the same statements those files use,
-- so running this first, last or twice all end in the same place.
alter table public.quote_requests add column if not exists fee_rate        numeric(5, 4);
alter table public.quote_requests add column if not exists fee_total_cents integer;
alter table public.quote_requests add column if not exists is_test         boolean not null default false;
alter table public.quote_requests add column if not exists archived_at     timestamptz;

-- ── 1. The columns a contractor must not write ──────────────────────────────
-- Enforced with a trigger rather than column-level grants because owners are
-- `authenticated` too: a GRANT UPDATE (cols) applies to the whole role and
-- would take the office's own edit rights with it.
--
-- The exemption is `auth.uid() is null`, which is exactly the service role: its
-- key carries no `sub` claim, so server code that has already authorized the
-- caller passes straight through.
--
-- Only columns with NO legitimate contractor write path are listed. Tokens are
-- not here (rotateTokens is open to whoever holds the job), and neither are
-- status/paid_at (the crew move their own cards, and a job marked paid with no
-- payment behind it already shows up on the cash board's "check these rows").
create or replace function public.guard_quote_money_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Service role (server code) and owners write freely.
  if auth.uid() is null or public.is_owner() then
    return new;
  end if;

  if new.fee_rate is distinct from old.fee_rate
     or new.fee_total_cents is distinct from old.fee_total_cents then
    raise exception 'fee_rate and fee_total_cents are set by the office'
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
$$;

drop trigger if exists qr_guard_money_columns on public.quote_requests;
create trigger qr_guard_money_columns
  before update on public.quote_requests
  for each row execute function public.guard_quote_money_columns();

-- ── 2. The ledger is not writable after the fact ────────────────────────────
-- The app never PATCHes quote_payments as a user. Taking the grant away costs
-- nothing and removes the only way a contractor could restate a payment that
-- has already been recorded - which is the row the office settles up from.
revoke update on public.quote_payments from authenticated;
drop policy if exists "staff update payments" on public.quote_payments;

-- ── 3. What a staff insert on the ledger is allowed to say ──────────────────
-- The one insert the app makes as a user is recordPayment: money the crew were
-- handed, in person, on a job that is theirs. Everything else - a card payment,
-- a pending checkout, anything carrying the office's cut - is written by the
-- server with the service role, and the service role does not consult this
-- policy at all.
--
-- So the shape is pinned to that one case:
--   * never 'card'          - a card payment is Stripe's word, not ours
--   * fee_cents = 0         - nothing was collected for the office on the way past
--   * status = 'paid'       - a hand-recorded payment is money already in hand
--   * recorded_by = you     - the row says who keyed it in, and cannot say
--                             somebody else did
--   * no Stripe identifiers - nothing to attach a real charge to
drop policy if exists "staff insert payments" on public.quote_payments;
create policy "staff insert payments" on public.quote_payments
  for insert to authenticated
  with check (
    (
      public.is_owner()
      or exists (
        select 1 from public.quote_requests q
        where q.id = quote_payments.quote_id and q.assigned_to = auth.uid()
      )
    )
    and method <> 'card'
    and fee_cents = 0
    and status = 'paid'
    and recorded_by = auth.uid()
    and stripe_account_id is null
    and checkout_session_id is null
    and payment_intent_id is null
    and refunded_cents = 0
  );

-- ── 4. Two people cannot collect the same balance twice ─────────────────────
-- recordManualPayment reads the ledger, checks the amount against what is still
-- owed, and then inserts. Those are three steps, and between the first and the
-- third somebody else can record a payment on the same job - the crew on site
-- and the office on the phone, or one person double-tapping a button on a slow
-- connection. Both requests see the same balance and both are allowed through,
-- and the job is over-collected.
--
-- The check belongs here, where it is one statement and cannot be raced.
--
-- Deliberately INSERT-only, and deliberately only for a signed-in user. A card
-- payment becoming paid is Stripe telling us money has ALREADY moved: refusing
-- to record it would not un-charge the customer, it would just lose the record
-- of it. That path is the service role's and passes straight through.
create or replace function public.guard_payment_not_over_total()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
$$;

drop trigger if exists qp_guard_over_total on public.quote_payments;
create trigger qp_guard_over_total
  before insert on public.quote_payments
  for each row execute function public.guard_payment_not_over_total();
