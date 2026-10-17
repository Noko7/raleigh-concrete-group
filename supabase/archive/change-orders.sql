-- Raleigh Concrete Group - change orders on a job that's already agreed
-- Run this once in Supabase → SQL Editor. Safe to re-run.
--
-- A customer who rings up a week before the pour wanting the patio two feet
-- wider used to leave the crew with nothing good to do. The quote was accepted
-- and the day was booked, so the only lever was the owner editing quote_amount
-- by hand - which changes what the customer owes without the customer ever
-- agreeing to it, and leaves no record that they did.
--
-- A change order is the price moving WITH the customer's say-so. One pending
-- change per job, held in these four columns: set together when the crew sends
-- it, cleared together when the customer answers. "Is there a change waiting?"
-- is therefore just "is change_requested_at set?", with no status column to
-- disagree with itself.
--
-- There is no history table and there does not need to be, for the same reason
-- there is none for quote versions: quote_events already records a row per
-- change with the old and new figures in its meta, so "how did this job get to
-- $9,400" is answerable from the log the office already reads.
--
-- Nothing here touches money. The deposit keeps counting on its own, because
-- the ledger has always been "what the job is worth now, minus what has been
-- collected" - see readLedger in src/lib/crm/fees.ts. Raise the total and the
-- balance grows by the difference; the $4,125 already in the bank stays put.

alter table public.quote_requests
  -- What is changing, in the crew's own words. Goes to the customer verbatim,
  -- so it is the one field on the form that has to be written for them to read.
  add column if not exists change_note text,
  -- The proposed NEW total for the whole job, not the difference. The delta is
  -- derived for every screen that shows one, which means there is exactly one
  -- number stored and no way for "+$1,200" and "$9,400" to drift apart.
  add column if not exists change_amount numeric(10,2),
  add column if not exists change_requested_at timestamptz,
  add column if not exists change_requested_by uuid references public.staff(id) on delete set null;

-- A pending change is all four or none of them. Belt and braces behind the
-- server, which only ever writes them as a set: a row carrying an amount with
-- no note would put a price in front of a customer with nothing explaining it.
alter table public.quote_requests drop constraint if exists quote_requests_change_complete;
alter table public.quote_requests add constraint quote_requests_change_complete check (
  (change_requested_at is null and change_amount is null and change_note is null)
  or (change_requested_at is not null and change_amount is not null and change_note is not null)
);

-- A change order can only ever lower a price to zero, never past it.
alter table public.quote_requests drop constraint if exists quote_requests_change_amount_sane;
alter table public.quote_requests add constraint quote_requests_change_amount_sane check (
  change_amount is null or (change_amount >= 0 and change_amount <= 99999999)
);
