-- Raleigh Concrete Group - CRM language preference
-- Run this AFTER crm.sql, once, in Supabase → SQL Editor. Safe to re-run.
--
-- Each staff member picks the language the CRM renders in. Stored on the staff
-- row rather than a cookie so it follows them to any device they sign in from,
-- which matters for crew who mostly use a phone.

alter table public.staff add column if not exists locale text not null default 'en';

alter table public.staff drop constraint if exists staff_locale_chk;
alter table public.staff add constraint staff_locale_chk
  check (locale in ('en', 'es'));
