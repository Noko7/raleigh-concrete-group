-- Raleigh Concrete Group - stage 1: a contractor cannot lower an agreed price
-- Run this AFTER least-privilege.sql and fee-waiver.sql, once, in Supabase ->
-- SQL Editor. Safe to re-run. Undo: stage1-price-lockdown.undo.sql.
-- Check it: stage1-price-lockdown.verify.sql (inside BEGIN ... ROLLBACK).
--
-- Why this file exists.
--
-- The office earns a percentage of the job total, so the job total is the
-- office's income. least-privilege.sql stopped a contractor rewriting the fee
-- RATE on their own job, but "contractor updates assigned" still lets them
-- PATCH every other column on it with their own access token - the anon key is
-- public and they know their own password - and the guard only looked at four
-- of them. The price itself was one of the columns it did not look at:
--
--   * quote_amount, after the customer had approved it. Halve the total and the
--     fee halves with it, because the ledger re-derives the fee from the frozen
--     rate against today's total (ensureFeeOnJob).
--   * customer_response, which is what locks the price: clear it and the job
--     reads as an open quote again, and the price is editable.
--   * status = 'paid' and paid_at, which the cash board reads as settled.
--   * deposit_target_cents, which only an approved change order sets.
--   * a change order already in front of the customer: rewrite change_amount
--     after they have read it, and the figure their Approve applies is not the
--     one they were shown.
--   * a change order of their own that LOWERS the total. The contractor can
--     read their job's public_token (and the text that carried the link), so
--     they can press the customer's Approve themselves. A contractor's change
--     may therefore only raise the total; lowering one is the owner's.
--   * the customer's phone and email, which every text and receipt goes to.
--
-- The owner's rule, which this file enforces for everyone who is not the owner
-- and not the server:
--
--   Before the customer answers, the crew edit the quote exactly as before.
--   Once they have answered, the price moves only through a change order the
--   customer approves - which the server applies with the service role
--   (apply_change_response), so it passes straight through this guard.
--
-- "Answered" is read the way the app reads it (isOpenAgain in queries.ts):
-- accepted, or declined and still Lost. A declined quote the office has moved
-- off Lost is open again - the customer's link shows it, and the next save
-- clears the old "no" - so the crew can re-price it, as they can today.
--
-- Every write the CRM makes with a contractor's token was checked against these
-- rules first (quote editor before an answer, phone approval, booking and
-- releasing a day, visits, photos, marking the job done, sending and
-- withdrawing a change order, rotating links, asking for payment). None of
-- them writes a column this refuses. The exemption is unchanged from
-- least-privilege.sql: `auth.uid() is null` is the service role (its key has no
-- `sub`), and owners pass on is_owner().
--
-- Section 3 replaces apply_change_response so the customer's Approve applies
-- only the change their page showed them (see there). Run the whole file at
-- once: it is one transaction.

begin;

-- ── 1. quote_requests ───────────────────────────────────────────────────────
-- Same function name and trigger as before, so CREATE OR REPLACE swaps the body
-- in place and qr_guard_money_columns keeps firing it. SECURITY DEFINER as the
-- live one is (is_owner() reads staff, which a contractor cannot see in full).
create or replace function public.guard_quote_money_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  answered boolean;
begin
  -- Service role (server code) and owners write freely.
  if auth.uid() is null or public.is_owner() then
    return new;
  end if;

  -- The customer's answer is on file (see the header for why declined-but-
  -- reopened does not count). Read off OLD: what the row said before this
  -- write, so clearing the answer and changing the price in one PATCH is
  -- refused the same as doing it in two.
  answered := coalesce(old.customer_response = 'accepted', false)
              or coalesce(old.customer_response = 'declined' and old.status = 'lost', false);

  -- ── Never, at any stage ──

  -- The office's cut: the rate, the frozen total, and the owner's waiver.
  -- (Unchanged from fee-waiver.sql.)
  if new.fee_rate is distinct from old.fee_rate
     or new.fee_total_cents is distinct from old.fee_total_cents
     or new.fee_waived_cents is distinct from old.fee_waived_cents
     or new.fee_waived_note is distinct from old.fee_waived_note then
    raise exception 'the office fee is set by the office'
      using errcode = '42501';
  end if;

  -- What the Money page counts at all. (Unchanged.)
  if new.is_test is distinct from old.is_test then
    raise exception 'is_test is set by the office' using errcode = '42501';
  end if;

  -- What the pipeline shows at all. (Unchanged.)
  if new.archived_at is distinct from old.archived_at then
    raise exception 'archiving a lead is done by the office' using errcode = '42501';
  end if;

  -- Paid. A job becomes paid when the ledger adds up (settleJobIfPaid /
  -- resyncJobPaidState, service role) or when the owner says so. A contractor
  -- marking their own job paid - or moving one off Paid - is a claim about
  -- money, not about the work. Every other status move stays theirs: booking
  -- (scheduled), releasing a day (approved), marking it done (completed),
  -- a phone approval (approved), sending a quote (quoted), and Lost (which the
  -- server writes for them anyway, see updateQuoteResult).
  if new.status is distinct from old.status
     and (new.status = 'paid' or old.status = 'paid') then
    raise exception 'only the office can mark a job paid, or move it off paid'
      using errcode = '42501';
  end if;
  if new.paid_at is distinct from old.paid_at then
    raise exception 'paid_at is set from the payments ledger' using errcode = '42501';
  end if;

  -- The second deposit a change asked for. Set only when the customer approves
  -- that change (apply_change_response, service role).
  if new.deposit_target_cents is distinct from old.deposit_target_cents then
    raise exception 'the deposit is set by an approved change order' using errcode = '42501';
  end if;

  -- Who the office texts and emails about the job.
  if new.phone is distinct from old.phone or new.email is distinct from old.email then
    raise exception 'the customer''s phone and email are changed by the office'
      using errcode = '42501';
  end if;

  -- ── Once the customer has answered ──

  if answered then
    -- The price they agreed to, and the decline credit that came off it.
    if new.quote_amount is distinct from old.quote_amount
       or new.discount_accepted is distinct from old.discount_accepted then
      raise exception 'the customer has approved this price; send a change order for them to approve'
        using errcode = '42501';
    end if;

    -- Their answer itself. Clearing it is what would unlock the price above.
    if new.customer_response is distinct from old.customer_response
       or new.customer_responded_at is distinct from old.customer_responded_at then
      raise exception 'the customer''s answer is on file and only the office can change it'
        using errcode = '42501';
    end if;
  end if;

  -- ── A change order already in front of the customer ──
  -- Opening one (none pending) and withdrawing one (all six cleared together,
  -- as CLEAR_CHANGE does) are both the crew's. Rewriting one in place is not:
  -- the customer may already be reading it, and their Approve applies whatever
  -- the row says at that moment.
  if old.change_requested_at is not null
     and row(new.change_note, new.change_amount, new.change_requested_at,
             new.change_requested_by, new.change_lines, new.change_deposit_cents)
         is distinct from
         row(old.change_note, old.change_amount, old.change_requested_at,
             old.change_requested_by, old.change_lines, old.change_deposit_cents)
     and not (new.change_note is null and new.change_amount is null
              and new.change_requested_at is null and new.change_requested_by is null
              and new.change_lines is null and new.change_deposit_cents is null) then
    raise exception 'a change is already waiting on the customer; withdraw it first'
      using errcode = '42501';
  end if;

  -- ── Opening a change order ──
  -- The contractor can reach the customer's link, so whatever they open they
  -- can also approve. Compared in cents against quote_amount, the total the
  -- fee is worked out from (toCents in fees.ts): change_amount is the new
  -- total, not a difference (apply_change_response sets quote_amount to it).
  if old.change_requested_at is null and new.change_requested_at is not null then
    if new.change_requested_by is distinct from auth.uid() then
      raise exception 'a change order is sent in your own name' using errcode = '42501';
    end if;
    if round(coalesce(new.change_amount, 0) * 100) < round(coalesce(old.quote_amount, 0) * 100) then
      raise exception 'lowering an approved price is done by the office' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

-- Re-stated so this file stands alone; identical to the live trigger.
create or replace trigger qr_guard_money_columns
  before update on public.quote_requests
  for each row execute function public.guard_quote_money_columns();

-- ── 2. The priced lines behind an answered quote ────────────────────────────
-- quote_options and quote_packages carry their own amounts. Once the customer
-- has answered they are the record of what was bought and at what price, and
-- the starting lines of every later change order. The app never rewrites them
-- after an answer as a contractor: saveQuote only writes lines while the quote
-- is open, and the phone-approval path only stamps customer_response and
-- responded_at on them, which stays allowed. A change order's new lines are
-- written by apply_change_response with the service role.
--
-- So for anyone but the server and the owner, on a job whose customer has
-- answered: no new line, no removed line, and no line repriced or moved to
-- another job. Titles, descriptions and the answer stamps are left alone.
--
-- SECURITY DEFINER because it reads the parent job, and the answer on it has
-- to be read whatever the caller's own policies would show them.
create or replace function public.guard_quote_line_prices()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  jobs uuid[];
begin
  if auth.uid() is null or public.is_owner() then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- The common case - stamping the customer's answer - touches neither.
    if new.amount is not distinct from old.amount
       and new.quote_id is not distinct from old.quote_id then
      return new;
    end if;
    jobs := array[old.quote_id, new.quote_id];
  elsif tg_op = 'INSERT' then
    jobs := array[new.quote_id];
  else
    jobs := array[old.quote_id];
  end if;

  if exists (
    select 1 from public.quote_requests q
     where q.id = any(jobs)
       and (q.customer_response = 'accepted'
            or (q.customer_response = 'declined' and q.status = 'lost'))
  ) then
    raise exception 'the customer has approved this price; send a change order for them to approve'
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace trigger qo_guard_line_prices
  before insert or update or delete on public.quote_options
  for each row execute function public.guard_quote_line_prices();

create or replace trigger qp_guard_line_prices
  before insert or update or delete on public.quote_packages
  for each row execute function public.guard_quote_line_prices();

-- ── 3. The customer's Approve applies what they were shown ──────────────────
-- /api/change-response sends only the token and accept/decline, and this
-- applied whatever the row held when it took the lock. If the change was
-- withdrawn and a different one opened while the customer's page was open,
-- their Approve landed on a figure they never saw. The page now sends the
-- change_requested_at it displayed; a mismatch under the lock is 'stale' and
-- nothing is written.
--
-- p_requested_at defaults to null, which skips the check: a call with only
-- p_id and p_accept (a page opened before this ran, recordChangeAgreed) behaves
-- exactly as before. Otherwise the body is the live one, verbatim.
--
-- The live body is kept as it is, renamed apply_change_response_core with no
-- API access, and the new three-argument apply_change_response wraps it: it
-- takes the row lock, answers 'stale' on a mismatch, and otherwise hands over
-- to the core, which re-takes the same lock in the same transaction. Renaming
-- rather than dropping leaves no second overload for the API to choose between.
do $$
begin
  if to_regprocedure('public.apply_change_response(uuid, boolean)') is not null then
    alter function public.apply_change_response(uuid, boolean) rename to apply_change_response_core;
    revoke all on function public.apply_change_response_core(uuid, boolean) from public, anon, authenticated, service_role;
  end if;
end $$;

create or replace function public.apply_change_response(p_id uuid, p_accept boolean, p_requested_at timestamptz default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_at timestamptz;
begin
  select change_requested_at into v_at from public.quote_requests where id = p_id for update;
  if found and v_at is not null and p_requested_at is not null and v_at is distinct from p_requested_at then
    return jsonb_build_object('status', 'stale');
  end if;
  return public.apply_change_response_core(p_id, p_accept);
end;
$function$;

revoke all on function public.apply_change_response(uuid, boolean, timestamptz) from public, anon, authenticated;
grant execute on function public.apply_change_response(uuid, boolean, timestamptz) to service_role;

commit;

-- PostgREST caches function signatures; this makes it pick up the new one now.
notify pgrst, 'reload schema';
