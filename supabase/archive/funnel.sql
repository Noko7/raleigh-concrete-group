-- Raleigh Concrete Group - quote funnel analytics
-- Run once in Supabase -> SQL Editor. Safe to re-run.
--
-- One row per thing a visitor did in the quote form: opened it, reached a
-- step, finished a step, gave up, hit an error, sent it. The CRM's Funnel page
-- (/crm/funnel, owners only) adds them up.
--
-- Nothing personal is stored. No name, phone, email or address - only which
-- step, how long, and which requirement was still unmet ("phone+address") when
-- someone left. attempt_id is random per opening of the form and visitor_id is
-- random per browser tab; neither is linked to the lead it may become.
--
-- Written only by /api/funnel with the service role, and read only by the
-- Funnel page with the service role after it has checked the viewer is an
-- owner. RLS is on with no policies, so the public anon key can do nothing
-- here at all.

create table if not exists public.site_funnel_events (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  attempt_id  text not null,
  visitor_id  text not null,
  form        text not null check (form in ('modal', 'estimate')),
  event       text not null check (event in ('open', 'view', 'done', 'back', 'close', 'error', 'submit')),
  step        text,
  ms          integer,
  mode        text,
  detail      text,
  path        text,
  device      text
);

create index if not exists site_funnel_events_created_at_idx on public.site_funnel_events (created_at desc);

alter table public.site_funnel_events enable row level security;
revoke all on public.site_funnel_events from anon, authenticated;
-- The server's key needs these spelled out: this project's default grants do
-- not cover new tables (schema.sql grants quote_requests the same way). Without
-- them every event came back 403 and the Funnel page stayed empty.
grant insert, select on public.site_funnel_events to service_role;

-- Supabase's free tier holds 500MB. At a few dozen rows per quote attempt this
-- table would take years to matter, but there is no reason to keep old clicks
-- forever. Run this by hand now and then, or schedule it with pg_cron:
--
--   delete from public.site_funnel_events where created_at < now() - interval '180 days';
