-- Raleigh Concrete Group - CRM extension
-- Run this AFTER schema.sql, once, in Supabase → SQL Editor. Safe to re-run.
--
-- Adds: staff (owner + contractors), CRM columns on quote_requests (status,
-- assignment, customer/job tokens, view tracking, quote amount), an activity
-- log, and Row-Level Security so a contractor can only ever see jobs assigned to
-- them. The public marketing site and the customer/job token pages never touch
-- these tables directly - those go through server code with the service-role key.

-- ── 1. Staff (one row per Supabase Auth user) ───────────────────────────────
create table if not exists public.staff (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  full_name  text,
  phone      text,
  role       text not null default 'contractor' check (role in ('owner', 'contractor')),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- New contractors get a temporary password and must set their own on first login.
alter table public.staff add column if not exists must_reset_password boolean not null default false;

alter table public.staff enable row level security;

-- Is the current logged-in user an active owner? SECURITY DEFINER so the policy
-- can read staff without recursing through staff's own RLS.
create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff s
    where s.id = auth.uid() and s.role = 'owner' and s.active
  );
$$;

drop policy if exists "staff self or owner read" on public.staff;
create policy "staff self or owner read" on public.staff
  for select to authenticated
  using (id = auth.uid() or public.is_owner());

drop policy if exists "owner manages staff" on public.staff;
create policy "owner manages staff" on public.staff
  for all to authenticated
  using (public.is_owner())
  with check (public.is_owner());

grant select, insert, update, delete on public.staff to authenticated;
grant all on public.staff to service_role;

-- New auth users get a contractor staff row that is INACTIVE by default. An
-- owner must explicitly activate it (Staff settings, or flip active = true)
-- before that person can sign in. This means a stray/self-service Supabase
-- signup can never reach the CRM on its own. Promote yourself to owner with the
-- snippet at the bottom of this file (that snippet sets active = true for you).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.staff (id, email, full_name, role, active)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''), 'contractor', false)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── 2. CRM columns on quote_requests ────────────────────────────────────────
alter table public.quote_requests add column if not exists status         text not null default 'new';
alter table public.quote_requests add column if not exists assigned_to    uuid references public.staff(id) on delete set null;
alter table public.quote_requests add column if not exists quote_amount   numeric(10, 2);
alter table public.quote_requests add column if not exists quote_summary  text;
alter table public.quote_requests add column if not exists internal_notes text;
alter table public.quote_requests add column if not exists public_token   text;
alter table public.quote_requests add column if not exists job_token      text;
alter table public.quote_requests add column if not exists viewed_at      timestamptz;
alter table public.quote_requests add column if not exists view_count     integer not null default 0;
alter table public.quote_requests add column if not exists quote_sent_at  timestamptz;
alter table public.quote_requests add column if not exists updated_at     timestamptz not null default now();

-- Customer self-service from the branded quote page: accept (with a scheduled
-- date) or decline, plus whether they took the 10%-off save offer.
alter table public.quote_requests add column if not exists customer_response     text;
alter table public.quote_requests add column if not exists customer_responded_at timestamptz;
alter table public.quote_requests add column if not exists scheduled_date        date;
alter table public.quote_requests add column if not exists discount_accepted     boolean not null default false;

-- In-person quote appointment the customer picked (so the crew can calendar it).
-- scheduled_date = the booked WORK day (max 1/day); visit_date = an in-person
-- quote visit (max 5/day). Both are enforced in server code.
alter table public.quote_requests add column if not exists visit_date  date;
alter table public.quote_requests add column if not exists visit_time  text;

-- Google Calendar event id, so we can update/cancel the invite we created for a
-- booked job or an in-person quote visit (see lib/crm/gcal.ts).
alter table public.quote_requests add column if not exists gcal_event_id text;

-- Job lifecycle timestamps: the 2-day confirmation reminder, the customer's
-- confirmation, when work was completed on site, when we asked for payment, and
-- when the money landed (Zelle / deposit).
alter table public.quote_requests add column if not exists reminder_sent_at     timestamptz;
alter table public.quote_requests add column if not exists confirmed_at         timestamptz;
alter table public.quote_requests add column if not exists completed_at         timestamptz;
alter table public.quote_requests add column if not exists payment_requested_at timestamptz;
alter table public.quote_requests add column if not exists paid_at              timestamptz;

-- Soft delete: "deleting" a lead from the CRM only sets this timestamp. The row
-- (and every related quote_event) stays in the database untouched - listQuotes
-- just hides archived rows from the pipeline/customers views by default, and
-- an owner can restore one from /crm/archived. Nothing is ever hard-deleted.
alter table public.quote_requests add column if not exists archived_at timestamptz;
create index if not exists qr_archived_idx on public.quote_requests(archived_at);

create index if not exists qr_scheduled_date_idx on public.quote_requests(scheduled_date);
create index if not exists qr_visit_date_idx      on public.quote_requests(visit_date);
-- Hard guarantee: at most one accepted/booked job per calendar day.
create unique index if not exists qr_one_job_per_day
  on public.quote_requests (scheduled_date)
  where customer_response = 'accepted';

alter table public.quote_requests drop constraint if exists qr_customer_response_chk;
alter table public.quote_requests add constraint qr_customer_response_chk
  check (customer_response is null or customer_response in ('accepted', 'declined'));

-- Simplified pipeline: New -> Quoted -> Scheduled -> Completed -> Paid (+ Lost).
-- Confirmation is a flag (confirmed_at) on a Scheduled job, not its own stage.
-- Migrate any rows still using older labels before tightening the constraint.
alter table public.quote_requests drop constraint if exists qr_status_chk;
update public.quote_requests set status = 'new'       where status = 'assigned';
update public.quote_requests set status = 'quoted'    where status in ('sent', 'viewed');
update public.quote_requests set status = 'scheduled' where status in ('won', 'booked', 'confirmed');
update public.quote_requests set status = 'completed' where status = 'complete';
alter table public.quote_requests add constraint qr_status_chk
  check (status in ('new', 'quoted', 'scheduled', 'completed', 'paid', 'lost'));

-- Unguessable capability tokens for the customer quote view and the contractor
-- job/photos view. Backfill existing rows, then default new rows.
update public.quote_requests set public_token = replace(gen_random_uuid()::text, '-', '') where public_token is null;
update public.quote_requests set job_token    = replace(gen_random_uuid()::text, '-', '') where job_token is null;
alter table public.quote_requests alter column public_token set default replace(gen_random_uuid()::text, '-', '');
alter table public.quote_requests alter column job_token    set default replace(gen_random_uuid()::text, '-', '');
create unique index if not exists qr_public_token_idx on public.quote_requests(public_token);
create unique index if not exists qr_job_token_idx    on public.quote_requests(job_token);
create index if not exists qr_assigned_idx on public.quote_requests(assigned_to);
create index if not exists qr_status_idx   on public.quote_requests(status);

-- Keep updated_at fresh on every change.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists qr_touch_updated_at on public.quote_requests;
create trigger qr_touch_updated_at
  before update on public.quote_requests
  for each row execute function public.touch_updated_at();

-- The server role needs UPDATE too (customer-view tracking on the public quote
-- page bumps view_count / status via the service-role key).
grant insert, select, update on public.quote_requests to service_role;

-- Staff read scoping: owners see everything, contractors see only their jobs.
grant select, update on public.quote_requests to authenticated;

drop policy if exists "staff read quotes" on public.quote_requests;
create policy "staff read quotes" on public.quote_requests
  for select to authenticated
  using (public.is_owner() or assigned_to = auth.uid());

drop policy if exists "owner updates quotes" on public.quote_requests;
create policy "owner updates quotes" on public.quote_requests
  for update to authenticated
  using (public.is_owner())
  with check (public.is_owner());

-- Contractors may update a job that is assigned to them, but cannot reassign it
-- away from themselves (the WITH CHECK keeps assigned_to = their id).
drop policy if exists "contractor updates assigned" on public.quote_requests;
create policy "contractor updates assigned" on public.quote_requests
  for update to authenticated
  using (assigned_to = auth.uid())
  with check (assigned_to = auth.uid());

-- ── 3. Activity log ─────────────────────────────────────────────────────────
create table if not exists public.quote_events (
  id         uuid primary key default gen_random_uuid(),
  quote_id   uuid not null references public.quote_requests(id) on delete cascade,
  type       text not null,
  meta       jsonb,
  actor      uuid references public.staff(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists qe_quote_idx on public.quote_events(quote_id);
alter table public.quote_events enable row level security;
grant select, insert on public.quote_events to authenticated;
grant all on public.quote_events to service_role;

drop policy if exists "staff read events" on public.quote_events;
create policy "staff read events" on public.quote_events
  for select to authenticated
  using (
    public.is_owner()
    or exists (
      select 1 from public.quote_requests q
      where q.id = quote_events.quote_id and q.assigned_to = auth.uid()
    )
  );

drop policy if exists "staff insert events" on public.quote_events;
create policy "staff insert events" on public.quote_events
  for insert to authenticated
  with check (
    public.is_owner()
    or exists (
      select 1 from public.quote_requests q
      where q.id = quote_events.quote_id and q.assigned_to = auth.uid()
    )
  );

-- ── 3b. Integrations (Google Calendar OAuth tokens, etc.) ───────────────────
-- Singleton-ish key/value store for third-party tokens. Only ever touched by
-- server code with the service-role key - no authenticated grants, RLS on with
-- no policies so a logged-in user can never read the refresh token.
create table if not exists public.app_integrations (
  provider   text primary key,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.app_integrations enable row level security;
grant all on public.app_integrations to service_role;

-- ── 3c. Login attempts (owner-visible security log) ─────────────────────────
-- Every POST to /crm/api/login writes one row here, success or failure, with
-- the service-role key (there's no user session yet at login time). Owners can
-- read it from the CRM Security dashboard; nothing else can touch it.
create table if not exists public.login_attempts (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  email      text,
  success    boolean not null,
  reason     text not null,
  staff_id   uuid references public.staff(id) on delete set null,
  ip         text,
  user_agent text
);
create index if not exists la_created_idx on public.login_attempts(created_at desc);
create index if not exists la_email_idx   on public.login_attempts(email);
create index if not exists la_ip_idx      on public.login_attempts(ip);

alter table public.login_attempts enable row level security;
grant all on public.login_attempts to service_role;
grant select on public.login_attempts to authenticated;

drop policy if exists "owner reads login attempts" on public.login_attempts;
create policy "owner reads login attempts" on public.login_attempts
  for select to authenticated
  using (public.is_owner());

-- ── 4. One-time: make yourself the owner ────────────────────────────────────
-- Passwords live in Supabase Auth (auth.users), NOT in this table - never add a
-- password column here.
-- 1) Supabase → Authentication → Users → "Add user" → set your email + password
--    and CHECK "Auto Confirm User" (an unconfirmed email can't sign in).
-- 2) Then run this (replace the email + your name). It links your auth user to a
--    staff row and flips it to owner:
--
insert into public.staff (id, email, full_name, role, active)
select id, email, 'Noah', 'owner', true
from auth.users
where email = 'noah@raleighconcrete.net'
on conflict (id) do update set role = 'owner', active = true;
