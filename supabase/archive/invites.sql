-- Raleigh Concrete Group - contractor invites
-- Run this AFTER crm.sql, once, in Supabase → SQL Editor. Safe to re-run.
--
-- Instead of the owner typing a contractor's details in by hand, they text an
-- invite to one phone number. That link opens a public onboarding form where the
-- contractor fills in their own name/email and chooses their own password, which
-- creates their account.
--
-- The token is the only thing protecting that form, so it is treated like a
-- capability: long and random, single-use, and short-lived.

create table if not exists public.contractor_invites (
  id         uuid primary key default gen_random_uuid(),
  -- 32 hex chars from gen_random_uuid(), same shape as the customer/job tokens.
  token      text not null unique,
  -- E.164, the only number this invite was ever sent to.
  phone      text not null,
  full_name  text,
  created_by uuid references public.staff(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  -- Set the moment an account is created from it; a used invite is dead.
  used_at    timestamptz,
  used_by    uuid references public.staff(id) on delete set null,
  revoked_at timestamptz
);

create index if not exists ci_token_idx   on public.contractor_invites(token);
create index if not exists ci_created_idx on public.contractor_invites(created_at desc);

alter table public.contractor_invites enable row level security;
grant all on public.contractor_invites to service_role;
grant select on public.contractor_invites to authenticated;

-- Owners can see the invites they've sent. Nobody else has any access, and the
-- public onboarding form never runs as a user - it goes through server code with
-- the service-role key, which is what lets an unauthenticated visitor redeem a
-- token without opening this table up.
drop policy if exists "owner reads invites" on public.contractor_invites;
create policy "owner reads invites" on public.contractor_invites
  for select to authenticated
  using (public.is_owner());
