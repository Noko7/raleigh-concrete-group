-- Raleigh Concrete Group - leads that exist to be practised on
-- Run in Supabase → SQL Editor. Safe to re-run.
--
-- Testing a payment means recording a real row in quote_payments: the same
-- table, the same arithmetic, the same webhook. That is the point - a test that
-- takes a different path tests nothing - and it is also why a morning spent
-- trying out a feature ends with the Money page reporting takings that never
-- happened.
--
-- Deleting them afterwards is the wrong answer twice over: it throws away the
-- fixture you will want again next week, and it is one careless `where` clause
-- from taking a real customer with it. So a lead can now say what it is.
--
-- is_test  this lead exists for testing. It behaves exactly like any other
--          lead everywhere in the app - it can be quoted, approved, scheduled,
--          paid, refunded - and it is left out of every figure on the Money
--          page unless you ask to see it.

alter table public.quote_requests add column if not exists is_test boolean not null default false;

-- Partial: test leads are a handful of rows against a table that only grows,
-- and the only query that wants them is the one asking for exactly these.
create index if not exists qr_is_test_idx on public.quote_requests(is_test) where is_test;

-- ── Test people ─────────────────────────────────────────────────────────────
-- The same problem one level up. A test contractor exists to be assigned work
-- and to settle a fee against, and both of those are real rows: the fee they
-- "sent over" was counting in "your fees, received" while the practice job
-- that earned it was hidden, so the office appeared to have been paid a cut it
-- never earned.
--
-- Their settlements stop counting and their row leaves the contractor table.
-- Jobs keep their own flag: a real customer job that happens to be assigned
-- to a test account is still a real job, and should not disappear because of
-- who is holding it.
alter table public.staff add column if not exists is_test boolean not null default false;

select id, full_name, email, role, active, is_test from public.staff order by full_name;

-- Name the practice accounts here, check the list above, then run it.
update public.staff
set is_test = true
where email ilike '%test%'
  and is_test = false;

-- ── Backfill ────────────────────────────────────────────────────────────────
-- LOOK at this list before running the update under it. `%test%` is a weak
-- filter - it matches "Noah test 2" and "James Test" as well as "Testv3",
-- which is the point - and a real customer whose name happens to contain it
-- would be quietly written out of your revenue.
select id, name, status, quote_amount, created_at,
       (select count(*) from public.quote_payments p where p.quote_id = q.id) as payment_rows
from public.quote_requests q
where q.name ilike '%test%'
order by q.created_at desc;

-- Once the list above is only rows you recognise as practice, run this.
update public.quote_requests
set is_test = true
where name ilike '%test%'
  and is_test = false;

-- ── The ones whose names do not say test ────────────────────────────────────
-- A pattern only finds leads somebody happened to name after what they were
-- doing. The practice job called "Marcus" looks exactly like a customer called
-- Marcus, and no filter will ever tell them apart - only you can.
--
-- Put their names in the list below, check the select, then run the update.
-- After this initial tidy-up, use the Test lead card at the bottom of a job
-- page instead: it is one button, it is owner-only, and it writes a line in
-- the job activity log saying who decided and when.
select id, name, status, quote_amount, is_test, created_at,
       (select count(*) from public.quote_payments p where p.quote_id = q.id) as payment_rows
from public.quote_requests q
where q.name in ('Jose', 'Marcus', 'James P')
order by q.created_at desc;

update public.quote_requests
set is_test = true
where name in ('Jose', 'Marcus', 'James P')
  and is_test = false;

-- ── Undo ────────────────────────────────────────────────────────────────────
-- A real lead caught by the filter. Put its id in and run it.
update public.quote_requests
set is_test = false
where false  -- <= change to true, and put the real id below
  and id = '00000000-0000-0000-0000-000000000000';

-- Nothing else needs changing. The Money page reads the flag, hides those rows
-- from every total by default, and has a switch to show them when you are
-- checking that a test payment landed the way you expected.
