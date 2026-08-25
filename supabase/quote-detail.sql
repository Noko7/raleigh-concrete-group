-- Raleigh Concrete Group — structured quotes, link expiry, service routing,
-- and job photos.
-- Run this in Supabase → SQL Editor. Safe to re-run (every statement is
-- idempotent).

-- ── 1. The five sections every quote covers ────────────────────────────────
-- Replaces the single free-text quote_summary as the thing the customer
-- reads. quote_summary is deliberately left in place: existing quotes still
-- have their text in it, and the customer page falls back to it for any quote
-- sent before this migration.
--
-- Each section is required before a quote can be sent, but "Not applicable"
-- is a valid answer - a slab replacement with no permit and nothing to
-- demolish should say so rather than leave the customer wondering what we
-- left out.
alter table public.quote_requests add column if not exists quote_scope text;
alter table public.quote_requests add column if not exists quote_permits text;
alter table public.quote_requests add column if not exists quote_prep text;
alter table public.quote_requests add column if not exists quote_pour text;
alter table public.quote_requests add column if not exists quote_cleanup text;

-- One cap for all five. quote_summary never had one (the 4000-char slice in
-- saveQuote was the only limit); these get a real constraint so a paste
-- accident can't put a novel on the customer's quote page.
alter table public.quote_requests drop constraint if exists qr_sections_chk;
alter table public.quote_requests add constraint qr_sections_chk check (
  (quote_scope    is null or char_length(quote_scope)    <= 2000)
  and (quote_permits is null or char_length(quote_permits) <= 2000)
  and (quote_prep    is null or char_length(quote_prep)    <= 2000)
  and (quote_pour    is null or char_length(quote_pour)    <= 2000)
  and (quote_cleanup is null or char_length(quote_cleanup) <= 2000)
);

-- ── 2. Quote links expire ──────────────────────────────────────────────────
-- Set to seven days out whenever the quote is sent, and re-set whenever it is
-- sent again, so a re-send is what revives an expired link. Null means "no
-- expiry recorded" - every quote sent before this migration, which the app
-- treats as still valid rather than retroactively killing live links.
alter table public.quote_requests add column if not exists quote_expires_at timestamptz;

-- ── 3. Job photos ──────────────────────────────────────────────────────────
-- file_urls holds what the CUSTOMER sent with their request and is written by
-- the public form. These three are ours:
--
--   internal_urls  reference photos staff add from the CRM after the fact
--   before_urls    the site before work started
--   after_urls     the finished work - required to mark a job complete, so
--                  there is always a record of what was handed over
alter table public.quote_requests add column if not exists internal_urls text[];
alter table public.quote_requests add column if not exists before_urls text[];
alter table public.quote_requests add column if not exists after_urls text[];

-- ── 4. Which job types each contractor takes ───────────────────────────────
-- Drives auto-assignment for both web and call-in leads. Null or empty means
-- "no restriction" - they can take anything, which is what every existing
-- contractor should keep doing until an owner says otherwise. Values are the
-- customer-facing service names from quoteServiceOptions (src/lib/site-data.ts),
-- matched case-insensitively because `service` is free text on the wire.
alter table public.staff add column if not exists service_types text[];
