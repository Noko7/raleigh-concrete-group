-- Raleigh Concrete Group — quote request storage
-- Run this once in your Supabase project: Dashboard → SQL Editor → New query → paste → Run.
-- Safe to re-run: every statement is idempotent.

-- ── 1. Leads table ──────────────────────────────────────────────────────────
create table if not exists public.quote_requests (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  name           text not null,
  phone          text not null,
  email          text,
  service        text,
  address        text,
  city           text,
  details        text,
  quote_type     text,        -- 'online' or 'inperson'
  preferred_time text,        -- in-person scheduling preference
  file_urls      jsonb,       -- array of uploaded photo/video URLs (online quotes)
  source_path    text
);

-- If the table already existed from an earlier version, add the new columns.
alter table public.quote_requests add column if not exists email text;
alter table public.quote_requests add column if not exists quote_type text;
alter table public.quote_requests add column if not exists preferred_time text;
alter table public.quote_requests add column if not exists file_urls jsonb;

-- Row Level Security: lock the table, then allow ONLY anonymous inserts.
-- The public site adds leads with the anon key but cannot read, edit or delete
-- them. You read leads in the Supabase dashboard (or with the service-role key).
alter table public.quote_requests enable row level security;

drop policy if exists "anon can insert quote requests" on public.quote_requests;
create policy "anon can insert quote requests"
  on public.quote_requests
  for insert
  to anon
  with check (true);

-- RLS decides WHICH rows are allowed; the GRANT decides whether the role may
-- touch the table at all. You need BOTH. Without this grant, inserts fail with
-- "permission denied for table quote_requests" (42501).
grant insert on public.quote_requests to anon;

-- ── 2. Storage bucket for customer photos / videos (PRIVATE) ─────────────────
-- Private bucket: files are NOT publicly accessible. The site stores each file's
-- path on the lead row (file_urls); you view the photos in the Supabase
-- dashboard (Storage → quote-uploads) or via a signed URL. The `do update`
-- flips an already-created bucket to private.
insert into storage.buckets (id, name, public)
values ('quote-uploads', 'quote-uploads', false)
on conflict (id) do update set public = false;

-- Let anonymous visitors upload into (only) the quote-uploads bucket. They can
-- write but not read, so customer photos stay private.
drop policy if exists "anon can upload quote files" on storage.objects;
create policy "anon can upload quote files"
  on storage.objects
  for insert
  to anon
  with check (bucket_id = 'quote-uploads');
