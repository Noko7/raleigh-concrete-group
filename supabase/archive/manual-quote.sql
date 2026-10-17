-- Raleigh Concrete Group - let an owner create a lead themselves
-- Run this in Supabase → SQL Editor. Safe to re-run.
--
-- Every quote_requests row so far has come from the public /api/quote
-- endpoint (service role, no session). This adds the missing insert grant +
-- RLS policy for the CRM's own "log a call-in lead" form, which runs as the
-- signed-in staff member (pgUser), not the service role. Owner-only, same as
-- the existing "owner updates quotes" policy below it - contractors can't
-- create leads, only work the ones assigned to them. Uses the same
-- public.is_owner() helper that policy already relies on.

grant insert on public.quote_requests to authenticated;

drop policy if exists "staff insert quotes" on public.quote_requests;
create policy "owner inserts quotes" on public.quote_requests
  for insert to authenticated
  with check (public.is_owner());
