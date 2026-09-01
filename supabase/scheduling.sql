-- Raleigh Concrete Group - approval / scheduling split
-- Run this AFTER crm.sql, once, in Supabase → SQL Editor. Safe to re-run.
--
-- Before: a customer accepting their quote also picked the install date, which
-- committed the crew to a day nobody had checked. After: accepting records the
-- approval and the customer's PREFERRED days, the job parks in a new "approved"
-- stage, and the assigned contractor (or an owner) confirms the real date.
--
-- Note on qr_one_job_per_day: it's a unique index on scheduled_date where
-- customer_response = 'accepted'. Approved-but-unscheduled rows have a NULL
-- date, and Postgres allows many NULLs in a unique index, so they coexist fine
-- while the one-job-per-day rule still holds for confirmed dates.

-- ── 1. New pipeline stage ───────────────────────────────────────────────────
-- new -> quoted -> approved (needs scheduling) -> scheduled -> completed -> paid
alter table public.quote_requests drop constraint if exists qr_status_chk;
alter table public.quote_requests add constraint qr_status_chk
  check (status in ('new', 'quoted', 'approved', 'scheduled', 'completed', 'paid', 'lost'));

-- Any job the customer already accepted but that has no date yet belongs in the
-- new stage, so nothing approved is left sitting invisibly in "scheduled".
update public.quote_requests
set status = 'approved'
where customer_response = 'accepted'
  and scheduled_date is null
  and status = 'scheduled';

-- ── 2. Customer's preferred days ────────────────────────────────────────────
-- Up to three ISO dates (YYYY-MM-DD) the customer said work for them. Stored as
-- text[] to match how file_urls is handled elsewhere.
alter table public.quote_requests add column if not exists preferred_dates text[];

-- Who confirmed the date and when, so the job page can show it and a reschedule
-- can be told apart from the first booking.
alter table public.quote_requests add column if not exists scheduled_by uuid references public.staff(id) on delete set null;
alter table public.quote_requests add column if not exists scheduled_at timestamptz;
