-- Raleigh Concrete Group — quoting from building plans
-- Run this in Supabase → SQL Editor. Safe to re-run.
--
-- Adds a third quote_type. The two existing ones describe how we look at a
-- job: 'online' from the customer's photos, 'inperson' by driving out.
-- 'plans' is the commercial case - an apartment block priced off the
-- architect's drawings, where nobody visits and there are no photos to work
-- from either.
--
-- Note what this does NOT mean. Everywhere in the app that asks "is somebody
-- expected at this address" reads quote_type together with visit_date
-- (visitDateOf in src/lib/crm/constants.ts), and that test was written as
-- "anything except online is a real visit". A 'plans' row has no visit, so
-- that test is inverted in the same commit as this migration: only
-- 'inperson', and legacy nulls, count as a booked visit.
--
-- qr_chk is redefined whole rather than patched: the original lives in
-- supabase/schema.sql and Postgres has no "alter constraint", so the only
-- honest way to change one clause is to drop and re-add all of them.

alter table public.quote_requests drop constraint if exists qr_chk;
alter table public.quote_requests add constraint qr_chk check (
  char_length(name) between 1 and 120
  and char_length(phone) between 7 and 32
  and (email is null or (char_length(email) <= 200 and email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'))
  and (service is null or char_length(service) <= 120)
  and (address is null or char_length(address) <= 300)
  and (city is null or char_length(city) <= 120)
  and (details is null or char_length(details) <= 2000)
  and (preferred_time is null or char_length(preferred_time) <= 120)
  and (quote_type is null or quote_type in ('online', 'inperson', 'plans'))
  and (file_urls is null or jsonb_typeof(file_urls) = 'array')
);
