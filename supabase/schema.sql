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

-- The PUBLIC (anon) role gets NO direct access to this table — it cannot read,
-- insert, update or delete. All writes go through the server route /api/quote,
-- which uses the secret service-role key (and re-validates every field). This
-- keeps customer leads safe from scraping and spam straight from the browser.
drop policy if exists "anon can insert quote requests" on public.quote_requests;
revoke all on public.quote_requests from anon;

-- Defense in depth: even a privileged writer must pass these checks, so junk
-- or oversized data can never land in the table.
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
  and (quote_type is null or quote_type in ('online', 'inperson'))
  and (file_urls is null or jsonb_typeof(file_urls) = 'array')
);

-- ── 2. Storage bucket for customer photos / videos (PRIVATE) ─────────────────
-- Private bucket: files are NOT publicly accessible. The site stores each file's
-- path on the lead row (file_urls); you view the photos in the Supabase
-- dashboard (Storage → quote-uploads) or via a signed URL. The `do update`
-- flips an already-created bucket to private.
insert into storage.buckets (id, name, public)
values ('quote-uploads', 'quote-uploads', false)
on conflict (id) do update set public = false;

-- Cap uploads at 50MB and only allow photo/video types (blocks arbitrary file
-- dumps into your storage even though the bucket accepts anonymous uploads).
update storage.buckets
set file_size_limit = 52428800,
    allowed_mime_types = array[
      'image/jpeg','image/png','image/webp','image/heic','image/heif','image/gif',
      'video/mp4','video/quicktime','video/webm'
    ]
where id = 'quote-uploads';

-- Let anonymous visitors upload into (only) the quote-uploads bucket. They can
-- write but not read, so customer photos stay private.
drop policy if exists "anon can upload quote files" on storage.objects;
create policy "anon can upload quote files"
  on storage.objects
  for insert
  to anon
  with check (bucket_id = 'quote-uploads');
