-- Raleigh Concrete Group - back-to-back quote visits + per-contractor hours
-- Run this AFTER crm.sql, scheduling.sql and locale.sql, once, in Supabase →
-- SQL Editor. Safe to re-run.
--
-- Before: quote visits were five fixed slots two hours apart, capped at five a
-- day for the whole business, and the cap was checked against whoever happened
-- to be the primary contractor. A crew member with a free afternoon could not
-- be booked into it, and a busy one could be booked on top of.
--
-- After: a visit is an hourly slot on ONE contractor's day. They can run back
-- to back all day with an hour between each, and the only limits are that
-- contractor's own working window and the hour of clearance either side.
--
-- Booked WORK days are deliberately untouched: still one per calendar day for
-- the whole business, still guaranteed by qr_one_job_per_day in crm.sql. A pour
-- is a crew, a truck and a day; only the visits stack.

-- ── 1. Each contractor's working window ─────────────────────────────────────
-- Both hours are the hour a slot STARTS, so 8..16 is nine slots, 8:00 AM
-- through 4:00 PM. Editable per person under CRM → Settings → Working hours.
alter table public.staff add column if not exists work_start_hour int not null default 8;
alter table public.staff add column if not exists work_end_hour   int not null default 16;

-- Days of the week they take visits, 0=Sunday .. 6=Saturday.
--
-- Defaulted to all seven rather than Monday-Friday on purpose. Customers could
-- already book a Saturday visit, and shipping a migration that quietly cancels
-- weekend availability for every contractor at once is not a default, it is a
-- policy change nobody asked for. The preference starts as "no restriction".
alter table public.staff add column if not exists work_days int[] not null default '{0,1,2,3,4,5,6}';

alter table public.staff drop constraint if exists staff_work_hours_chk;
alter table public.staff add constraint staff_work_hours_chk
  check (
    work_start_hour between 5 and 21
    and work_end_hour between 5 and 21
    and work_end_hour >= work_start_hour
  );

-- ── 2. The time the customer asked for, per preferred day ───────────────────
-- Index-aligned with preferred_dates: preferred_times[i] is the start time the
-- customer wants on preferred_dates[i]. Text, like scheduled_time and
-- visit_time, because it is display copy ("9:00 AM") and never arithmetic.
--
-- Nullable and allowed to be shorter than preferred_dates: every quote accepted
-- before this column existed has days with no time against them, and the crew's
-- scheduling card falls back to its own default for those.
alter table public.quote_requests add column if not exists preferred_times text[];

-- ── 3. A lost job stops holding its day ─────────────────────────────────────
-- qr_one_job_per_day guarantees at most one accepted job per calendar day. It
-- did not exclude lost ones, so a customer who accepted, got a date and then
-- pulled out kept that day locked forever if the lead was dragged to Lost
-- rather than having its appointment cancelled - and no screen said why the
-- day was full. The app's own countJobsOn is widened to match.
--
-- Safe to run: the new index is strictly looser than the old one, so any data
-- the old one allowed the new one allows too.
drop index if exists public.qr_one_job_per_day;
create unique index if not exists qr_one_job_per_day
  on public.quote_requests (scheduled_date)
  where customer_response = 'accepted' and status <> 'lost';

-- ── Note on enforcement ─────────────────────────────────────────────────────
-- There is deliberately no unique index behind the one-hour gap. It is a
-- distance between start times rather than a repeated value, so it is not
-- expressible as uniqueness - and a contractor booking a 9:30 visit from their
-- job page has to block both the 9:00 and the 10:00 slot, which a unique index
-- on (assigned_to, visit_date, visit_time) would let straight through. Every
-- path that writes a visit date runs findVisitConflict first: the public quote
-- form, confirmVisit, rescheduleVisit and the calendar's drag-and-drop.
