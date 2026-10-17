-- Raleigh Concrete Group - how often each contractor opens each job
--
-- One row per (job, contractor): how many times they opened the job page, and
-- when first and last. Owner-only to read. Written only by the server (service
-- role) through bump_job_staff_view, never by a contractor's own login, so
-- nobody can edit their own count. Safe to re-run.

create table if not exists public.job_staff_views (
  quote_id uuid not null references public.quote_requests(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  view_count integer not null default 0,
  first_viewed_at timestamptz not null default now(),
  last_viewed_at timestamptz not null default now(),
  primary key (quote_id, staff_id)
);

alter table public.job_staff_views enable row level security;

drop policy if exists "owner reads crew views" on public.job_staff_views;
create policy "owner reads crew views" on public.job_staff_views
  for select to authenticated using (public.is_owner());

revoke all on public.job_staff_views from anon, authenticated;
grant select on public.job_staff_views to authenticated;

-- The server writes through this; this database grants new tables to nobody by
-- default, so the service role gets its rights explicitly.
grant select, insert, update on public.job_staff_views to service_role;

-- Body as a plain string: the SQL runner used here hangs on $$ bodies.
create or replace function public.bump_job_staff_view(p_quote uuid, p_staff uuid)
  returns void language sql security invoker set search_path to 'public'
  as 'insert into public.job_staff_views (quote_id, staff_id, view_count) values (p_quote, p_staff, 1) on conflict (quote_id, staff_id) do update set view_count = job_staff_views.view_count + 1, last_viewed_at = now()';

revoke execute on function public.bump_job_staff_view(uuid, uuid) from public, anon, authenticated;
grant execute on function public.bump_job_staff_view(uuid, uuid) to service_role;
