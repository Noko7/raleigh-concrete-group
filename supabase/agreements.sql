-- Raleigh Concrete Group — signed agreements
-- Run this AFTER crm.sql, once, in Supabase → SQL Editor. Safe to re-run.
--
-- Stores the contracts you send out through DocuSeal. DocuSeal itself is managed
-- separately (you build the template there, it emails the signer, and the signer
-- signs on DocuSeal's hosted page). This table is the CRM-side record: what was
-- sent, to whom, where it stands, an optional link back to the DocuSeal
-- submission, and the signed PDF once you download it.
--
-- Two kinds:
--   contractor — one onboarding agreement per crew member (staff_id)
--   customer   — one agreement per job (quote_id)

-- ── 1. Private bucket for contract files ────────────────────────────────────
-- Private, exactly like quote-uploads: no anon read/write policy exists, so the
-- only way to see a contract is through the authenticated CRM proxy at
-- /crm/api/agreement, which scopes access with RLS.
insert into storage.buckets (id, name, public)
values ('agreements', 'agreements', false)
on conflict (id) do update set public = false;

-- 25MB is plenty for a signed contract; PDFs plus scans/photos of a wet-ink copy.
update storage.buckets
set file_size_limit = 26214400,
    allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/webp']
where id = 'agreements';

-- ── 2. Agreements table ─────────────────────────────────────────────────────
create table if not exists public.agreements (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('contractor', 'customer')),
  -- Exactly one of these is set, enforced by agreements_target_chk below.
  staff_id     uuid references public.staff(id) on delete cascade,
  quote_id     uuid references public.quote_requests(id) on delete cascade,
  title        text not null,
  status       text not null default 'pending'
               check (status in ('pending', 'sent', 'signed', 'declined', 'void')),
  file_path    text,
  docuseal_url text,
  sent_at      timestamptz,
  signed_at    timestamptz,
  notes        text,
  created_by   uuid references public.staff(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- A contractor agreement hangs off a staff row; a customer agreement off a job.
-- Never both, never neither — otherwise the RLS policies below can't scope it.
alter table public.agreements drop constraint if exists agreements_target_chk;
alter table public.agreements add constraint agreements_target_chk
  check (
    (kind = 'contractor' and staff_id is not null and quote_id is null)
    or
    (kind = 'customer' and quote_id is not null and staff_id is null)
  );

create index if not exists ag_staff_idx   on public.agreements(staff_id);
create index if not exists ag_quote_idx   on public.agreements(quote_id);
create index if not exists ag_status_idx  on public.agreements(status);
create index if not exists ag_created_idx on public.agreements(created_at desc);

alter table public.agreements enable row level security;
grant select, insert, update, delete on public.agreements to authenticated;
grant all on public.agreements to service_role;

-- Owners see and manage everything. A contractor sees only their own onboarding
-- agreement and the customer agreements for jobs assigned to them — the same
-- scoping rule the rest of the CRM uses.
drop policy if exists "staff read agreements" on public.agreements;
create policy "staff read agreements" on public.agreements
  for select to authenticated
  using (
    public.is_owner()
    or staff_id = auth.uid()
    or exists (
      select 1 from public.quote_requests q
      where q.id = agreements.quote_id and q.assigned_to = auth.uid()
    )
  );

-- Only owners create, edit or delete agreements. Contractors are read-only here:
-- they sign in DocuSeal, they don't change the CRM record.
drop policy if exists "owner writes agreements" on public.agreements;
create policy "owner writes agreements" on public.agreements
  for all to authenticated
  using (public.is_owner())
  with check (public.is_owner());

-- Keep updated_at honest.
create or replace function public.touch_agreements_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists agreements_touch_updated_at on public.agreements;
create trigger agreements_touch_updated_at
  before update on public.agreements
  for each row execute function public.touch_agreements_updated_at();
