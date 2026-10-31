-- Raleigh Concrete Group - customer agreements signed through DocuSeal, contractor first, then the customer
-- Undo: undo/PENDING_agreement_signing.undo.sql. Check: verify/PENDING_agreement_signing.verify.sql.
-- Needs PENDING_agreement_versions first.
--
-- A saved agreement version is sent to DocuSeal as one submission. The contractor signs inside the CRM, then the
-- customer signs on a public page reached by a texted link. DocuSeal's webhooks move the agreement along and the
-- signed PDF and audit log are copied into the private agreements bucket.
--
--   1. agreements gains the signing record: which version was sent, the DocuSeal submission, each signer
--      (role, DocuSeal submitter id, slug, embed link, signed/declined time), when it was sent, when the
--      contractor signed, when it completed, when it expires, why it was declined, the stored signed PDF and audit
--      log, and sign_token (the unguessable part of the customer's link, /sign/<token>).
--   2. Statuses: pending (a draft), sent (waiting on the contractor), contractor_signed (waiting on the
--      customer), signed, declined, expired, void. Declined, expired and a cancelled send go back to being
--      editable; signed and void are final.
--   3. A version cannot be saved while its agreement is out for signature or finished (sent, contractor_signed,
--      signed, void): the signed document must be exactly the version that was sent. Enforced in the numbering
--      trigger, for every role.
--   4. document_events: every DocuSeal webhook, recorded once (unique on submission, event and its time), so a
--      retried delivery changes nothing. Service role only: no API access for anyone else.

set local lock_timeout = '5s';

-- ── 1. The signing record ───────────────────────────────────────────────────
alter table public.agreements add column if not exists sent_version_id uuid;
alter table public.agreements add column if not exists docuseal_submission_id bigint;
alter table public.agreements add column if not exists signers jsonb;
alter table public.agreements add column if not exists contractor_signed_at timestamp with time zone;
alter table public.agreements add column if not exists completed_at timestamp with time zone;
alter table public.agreements add column if not exists expires_at timestamp with time zone;
alter table public.agreements add column if not exists decline_reason text;
alter table public.agreements add column if not exists signed_pdf_path text;
alter table public.agreements add column if not exists audit_log_path text;
alter table public.agreements add column if not exists sign_token text;

alter table public.agreements add constraint agreements_sent_version_fkey
  FOREIGN KEY (sent_version_id) REFERENCES agreement_versions(id);
alter table public.agreements add constraint agreements_docuseal_submission_key UNIQUE (docuseal_submission_id);
alter table public.agreements add constraint agreements_sign_token_key UNIQUE (sign_token);
alter table public.agreements add constraint agreements_signing_chk CHECK (
  (signers is null or jsonb_typeof(signers) = 'array')
  and (decline_reason is null or char_length(decline_reason) <= 1000)
  and (sign_token is null or sign_token ~ '^[0-9a-f]{32}$')
  and (signed_pdf_path is null or char_length(signed_pdf_path) <= 300)
  and (audit_log_path is null or char_length(audit_log_path) <= 300)
);

-- ── 2. Statuses ─────────────────────────────────────────────────────────────
alter table public.agreements drop constraint agreements_status_check;
alter table public.agreements add constraint agreements_status_check CHECK (
  status = ANY (ARRAY['pending'::text, 'sent'::text, 'contractor_signed'::text, 'signed'::text, 'declined'::text, 'expired'::text, 'void'::text])
);

-- ── 3. No new version while out for signature or finished ───────────────────
create or replace function public.number_agreement_version()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare who uuid := auth.uid(); st text;
begin
  select status into st from public.agreements where id = new.agreement_id for update;
  if not found then
    raise exception 'agreement % does not exist', new.agreement_id using errcode = '23503';
  end if;
  if st in ('sent', 'contractor_signed', 'signed', 'void') then
    raise exception 'this agreement is out for signature or closed; cancel the signing or start an amendment' using errcode = '42501';
  end if;
  select coalesce(max(version_no), 0) + 1 into new.version_no from public.agreement_versions where agreement_id = new.agreement_id;
  new.created_at := now();
  new.html_sha256 := encode(sha256(convert_to(new.html, 'UTF8')), 'hex');
  -- A signed-in save is stamped with that person, whatever the app sent. Server jobs (service role) pass their own.
  if who is not null then
    new.created_by := who;
    select full_name into new.created_by_name from public.staff where id = who;
  end if;
  return new;
end;
$function$;
revoke execute on function public.number_agreement_version() from public;

-- ── 4. Webhook events, once each ────────────────────────────────────────────
create table public.document_events (
  id uuid default gen_random_uuid() not null,
  agreement_id uuid,
  submission_id bigint not null,
  event_type text not null,
  event_at timestamp with time zone not null,
  payload jsonb not null,
  received_at timestamp with time zone default now() not null,
  constraint document_events_pkey PRIMARY KEY (id),
  constraint document_events_once_key UNIQUE (submission_id, event_type, event_at),
  constraint document_events_agreement_fkey FOREIGN KEY (agreement_id) REFERENCES agreements(id) ON DELETE SET NULL,
  constraint document_events_chk CHECK (char_length(event_type) between 1 and 60 and jsonb_typeof(payload) = 'object')
);
CREATE INDEX document_events_agreement_idx ON public.document_events USING btree (agreement_id, received_at DESC);
alter table public.document_events enable row level security;
revoke all on public.document_events from anon, authenticated;
grant all on public.document_events to service_role;
