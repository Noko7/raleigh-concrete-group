-- Raleigh Concrete Group - quote forms that were started but never sent
-- Run once in Supabase -> SQL Editor. Safe to re-run. (Applied to the live
-- database on 24 Sep 2026.)
--
-- The quote form saves what the customer has typed here as soon as there is a
-- name and a phone number to call, keyed by the same submission id it later
-- sends to /api/quote (see src/app/api/quote/draft/route.ts). When the request
-- is sent, lead_id is filled in. A row with no lead_id is somebody who got far
-- enough to leave a number and then didn't send - closed the tab, got stuck on
-- the address, hit an error - and the CRM's Funnel page lists them so the
-- office can call.
--
-- Nobody is texted from this table. The customer hasn't agreed to texts until
-- they press the button on the last step; the owner gets an alert, and calls.

create table if not exists public.quote_drafts (
  submission_id uuid primary key,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  name          text,
  phone         text,
  email         text,
  address       text,
  mode          text,
  service       text,
  step          text,
  source_path   text,
  lead_id       uuid,
  left_at       timestamptz,
  alerted_at    timestamptz,
  dismissed_at  timestamptz
);

create index if not exists quote_drafts_updated_at_idx on public.quote_drafts (updated_at desc);

alter table public.quote_drafts enable row level security;
revoke all on public.quote_drafts from anon, authenticated;
grant select, insert, update on public.quote_drafts to service_role;

-- Personal details of people who never became customers. Nothing reads rows
-- this old, so there is no reason to keep them:
--
--   delete from public.quote_drafts where updated_at < now() - interval '90 days';
