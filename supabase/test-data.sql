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

-- ── Undo ────────────────────────────────────────────────────────────────────
-- A real lead caught by the filter. Put its id in and run it.
update public.quote_requests
set is_test = false
where false  -- <= change to true, and put the real id below
  and id = '00000000-0000-0000-0000-000000000000';

-- Nothing else needs changing. The Money page reads the flag, hides those rows
-- from every total by default, and has a switch to show them when you are
-- checking that a test payment landed the way you expected.
