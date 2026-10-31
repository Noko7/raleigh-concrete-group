-- Undo PENDING_agreement_signing.
--
-- Refuses once any agreement has been sent through DocuSeal: the signing record (who signed what, when, and the
-- stored signed PDF) would be lost. Export public.agreements and public.document_events first, then, only if you
-- are sure, delete the guard block below and run it again.

set local lock_timeout = '5s';

do $$
begin
  if exists (select 1 from public.agreements where docuseal_submission_id is not null)
     or exists (select 1 from public.agreements where status in ('contractor_signed', 'expired')) then
    raise exception 'agreements have been sent for signing; export them before undoing (see the comment at the top)';
  end if;
end $$;

drop table public.document_events;

-- The numbering trigger as it was before signing existed.
create or replace function public.number_agreement_version()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare who uuid := auth.uid();
begin
  perform 1 from public.agreements where id = new.agreement_id for update;
  if not found then
    raise exception 'agreement % does not exist', new.agreement_id using errcode = '23503';
  end if;
  select coalesce(max(version_no), 0) + 1 into new.version_no from public.agreement_versions where agreement_id = new.agreement_id;
  new.created_at := now();
  new.html_sha256 := encode(sha256(convert_to(new.html, 'UTF8')), 'hex');
  if who is not null then
    new.created_by := who;
    select full_name into new.created_by_name from public.staff where id = who;
  end if;
  return new;
end;
$function$;
revoke execute on function public.number_agreement_version() from public;

alter table public.agreements drop constraint agreements_status_check;
alter table public.agreements add constraint agreements_status_check CHECK (
  status = ANY (ARRAY['pending'::text, 'sent'::text, 'signed'::text, 'declined'::text, 'void'::text])
);
alter table public.agreements drop constraint if exists agreements_signing_chk;
alter table public.agreements drop constraint if exists agreements_sign_token_key;
alter table public.agreements drop constraint if exists agreements_docuseal_submission_key;
alter table public.agreements drop constraint if exists agreements_sent_version_fkey;
alter table public.agreements
  drop column if exists sign_token,
  drop column if exists audit_log_path,
  drop column if exists signed_pdf_path,
  drop column if exists decline_reason,
  drop column if exists expires_at,
  drop column if exists completed_at,
  drop column if exists contractor_signed_at,
  drop column if exists signers,
  drop column if exists docuseal_submission_id,
  drop column if exists sent_version_id;
