-- Undo PENDING_agreement_versions.
--
-- Saved agreement versions are the record of what was offered and signed. This refuses to run once any version
-- exists: dropping the table would destroy that history. Export them first (select * from
-- public.agreement_versions), then, only if you are sure, delete the guard block below and run it again.

set local lock_timeout = '5s';

do $$
begin
  if exists (select 1 from public.agreement_versions) then
    raise exception 'agreement versions exist; export them before undoing (see the comment at the top)';
  end if;
end $$;

alter table public.agreements drop constraint if exists agreements_current_version_fkey;
alter table public.agreements drop column if exists current_version_id;
drop table public.agreement_versions;
drop function if exists public.number_agreement_version();
drop function if exists public.point_agreement_at_version();
drop function if exists public.guard_agreement_version();
alter table public.quote_requests drop constraint if exists quote_requests_estimated_duration_chk;
alter table public.quote_requests drop column if exists estimated_duration;
alter table public.staff drop constraint if exists staff_agreement_fields_chk;
alter table public.staff drop column if exists payment_methods;
alter table public.staff drop column if exists license_number;
