-- Raleigh Concrete Group - customer agreements signed through DocuSeal, contractor first, then the customer
-- Undo: undo/PENDING_agreement_signing.undo.sql. Check: verify/PENDING_agreement_signing.verify.sql.
-- Needs 20261031130207_agreement_versions (applied) first.
--
-- A saved agreement version is sent to DocuSeal as one submission. The contractor signs inside the CRM, then the
-- customer signs on a public page reached by a texted link. DocuSeal's webhooks move the agreement along and the
-- signed PDF and audit log are copied into the private agreements bucket.
--
--   1. agreements gains the signing record anyone allowed to see the agreement may see: which version was sent,
--      the DocuSeal submission id, when it was sent, when the contractor signed, when it completed, when it
--      expires, why it was declined, and the stored signed PDF and audit log. sent_version_id must be a version
--      of the same agreement (composite key).
--   2. agreement_signing holds what lets someone SIGN: each signer's DocuSeal embed link and slug, and
--      sign_token (the customer's /sign/<token> link). Service role only, so a contractor can't read the
--      customer's link through the API; the server hands each person only their own.
--   3. Statuses: pending (a draft), sent (waiting on the contractor), contractor_signed (waiting on the
--      customer), signed, declined, expired, void. Declined, expired and a cancelled send can be edited and sent
--      again; signed and void are final.
--   4. A version cannot be saved while its agreement is out for signature or finished (sent, contractor_signed,
--      signed, void): the signed document must be exactly the version that was sent. Enforced in the numbering
--      trigger, for every role.
--   5. document_events: every DocuSeal webhook, recorded once (unique on submission, event, signer role and its
--      time) with processed_at set only after it has been acted on, so a retry after a failure is acted on and
--      a retry after success is not. Service role only.

set local lock_timeout = '5s';

-- ── 1. The signing record ───────────────────────────────────────────────────
alter table public.agreements add column if not exists sent_version_id uuid;
alter table public.agreements add column if not exists docuseal_submission_id bigint;
alter table public.agreements add column if not exists contractor_signed_at timestamp with time zone;
alter table public.agreements add column if not exists completed_at timestamp with time zone;
alter table public.agreements add column if not exists expires_at timestamp with time zone;
alter table public.agreements add column if not exists decline_reason text;
alter table public.agreements add column if not exists signed_pdf_path text;
alter table public.agreements add column if not exists audit_log_path text;

-- A version can only be "the version sent" for its own agreement.
alter table public.agreement_versions add constraint agreement_versions_agreement_id_id_key UNIQUE (agreement_id, id);
alter table public.agreements add constraint agreements_sent_version_fkey
  FOREIGN KEY (id, sent_version_id) REFERENCES agreement_versions(agreement_id, id);
alter table public.agreements add constraint agreements_docuseal_submission_key UNIQUE (docuseal_submission_id);
alter table public.agreements add constraint agreements_signing_chk CHECK (
  (decline_reason is null or char_length(decline_reason) <= 1000)
  and (signed_pdf_path is null or char_length(signed_pdf_path) <= 300)
  and (audit_log_path is null or char_length(audit_log_path) <= 300)
);

-- ── 2. What lets someone sign: server only ──────────────────────────────────
create table public.agreement_signing (
  agreement_id uuid not null,
  submission_id bigint not null,
  sign_token text not null,
  contractor_staff_id uuid,
  signers jsonb not null,
  customer_texted_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  constraint agreement_signing_pkey PRIMARY KEY (agreement_id),
  constraint agreement_signing_agreement_fkey FOREIGN KEY (agreement_id) REFERENCES agreements(id) ON DELETE CASCADE,
  constraint agreement_signing_submission_key UNIQUE (submission_id),
  constraint agreement_signing_token_key UNIQUE (sign_token),
  constraint agreement_signing_chk CHECK (sign_token ~ '^[0-9a-f]{32}$' and jsonb_typeof(signers) = 'array')
);
alter table public.agreement_signing enable row level security;
revoke all on public.agreement_signing from anon, authenticated;
grant all on public.agreement_signing to service_role;

-- ── 3. Statuses ─────────────────────────────────────────────────────────────
alter table public.agreements drop constraint agreements_status_check;
alter table public.agreements add constraint agreements_status_check CHECK (
  status = ANY (ARRAY['pending'::text, 'sent'::text, 'contractor_signed'::text, 'signed'::text, 'declined'::text, 'expired'::text, 'void'::text])
);

-- ── 4. No new version while out for signature or finished ───────────────────
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

-- ── 5. Webhook events ───────────────────────────────────────────────────────
create table public.document_events (
  id uuid default gen_random_uuid() not null,
  agreement_id uuid,
  submission_id bigint not null,
  event_type text not null,
  signer_role text default ''::text not null,
  event_at timestamp with time zone not null,
  payload jsonb not null,
  received_at timestamp with time zone default now() not null,
  processed_at timestamp with time zone,
  constraint document_events_pkey PRIMARY KEY (id),
  constraint document_events_once_key UNIQUE (submission_id, event_type, signer_role, event_at),
  constraint document_events_agreement_fkey FOREIGN KEY (agreement_id) REFERENCES agreements(id) ON DELETE SET NULL,
  constraint document_events_chk CHECK (
    char_length(event_type) between 1 and 60
    and signer_role in ('', 'Contractor', 'Customer')
    and jsonb_typeof(payload) = 'object'
  )
);
CREATE INDEX document_events_agreement_idx ON public.document_events USING btree (agreement_id, received_at DESC);
alter table public.document_events enable row level security;
revoke all on public.document_events from anon, authenticated;
grant all on public.document_events to service_role;
