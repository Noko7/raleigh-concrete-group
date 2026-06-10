-- Raleigh Concrete Group — quote request storage
-- Run this once in your Supabase project: Dashboard → SQL Editor → New query → paste → Run.

create table if not exists public.quote_requests (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  name        text not null,
  phone       text not null,
  service     text,
  address     text,
  city        text,
  details     text,
  source_path text
);

-- Row Level Security: lock the table down, then allow ONLY anonymous inserts.
-- The public website uses the anon key to add new leads, but cannot read,
-- edit, or delete them. You read your leads from the Supabase dashboard
-- (or with the service-role key on a server you control).
alter table public.quote_requests enable row level security;

drop policy if exists "anon can insert quote requests" on public.quote_requests;
create policy "anon can insert quote requests"
  on public.quote_requests
  for insert
  to anon
  with check (true);
