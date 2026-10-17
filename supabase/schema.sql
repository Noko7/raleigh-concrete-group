-- Raleigh Concrete Group - live public schema
--
-- REFERENCE ONLY - DO NOT RUN. This is what the production database looks like,
-- not a script to build it. To change the database, add a file to
-- supabase/migrations/ (see the README's database section), then regenerate this.
--
-- Generated 2026-10-17 from read-only catalog queries on the production project
-- (PostgreSQL 17.6), after migrations 20261017221826 (stage 1) and 20261017222017
-- (stage 3): pg_attribute/pg_attrdef, pg_constraint, pg_get_indexdef, pg_class
-- (RLS flags), pg_policies, pg_get_functiondef, pg_get_triggerdef, relacl/proacl,
-- pg_default_acl. No table rows were read.
--
-- Not reproduced faithfully:
--   * send_to_make's webhook URL is replaced with '<redacted>' (a live credential;
--     see the Supabase dashboard). The trigger is DISABLED.
--   * Several function bodies are stored with CRLF line endings (pasted from the
--     SQL Editor); they are shown here with LF.
--   * Foreign keys print as `staff(id)` / `quote_requests(id)` (public, unqualified),
--     exactly as pg_get_constraintdef returns them.
--   * Grants are listed as they resolve from relacl/proacl. Owner rights
--     (postgres) are not repeated.
--   * Out of scope: other schemas (auth, storage, extensions...) except the
--     auth.users trigger that calls public.handle_new_user(), and the two
--     storage buckets, noted at the end.
--
-- Extensions: plpgsql, pgcrypto, uuid-ossp, pg_stat_statements, pg_net
-- (schema extensions), supabase_vault. No views, no custom types, no comments.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Tables (columns, defaults, constraints)
-- ════════════════════════════════════════════════════════════════════════════

create table public.agreements (
  id uuid default gen_random_uuid() not null,
  kind text not null,
  staff_id uuid,
  quote_id uuid,
  title text not null,
  status text default 'pending'::text not null,
  file_path text,
  docuseal_url text,
  sent_at timestamp with time zone,
  signed_at timestamp with time zone,
  notes text,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint agreements_pkey PRIMARY KEY (id),
  constraint agreements_created_by_fkey FOREIGN KEY (created_by) REFERENCES staff(id) ON DELETE SET NULL,
  constraint agreements_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES quote_requests(id) ON DELETE CASCADE,
  constraint agreements_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE,
  constraint agreements_kind_check CHECK ((kind = ANY (ARRAY['contractor'::text, 'customer'::text]))),
  constraint agreements_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'signed'::text, 'declined'::text, 'void'::text]))),
  constraint agreements_target_chk CHECK ((((kind = 'contractor'::text) AND (staff_id IS NOT NULL) AND (quote_id IS NULL)) OR ((kind = 'customer'::text) AND (quote_id IS NOT NULL) AND (staff_id IS NULL))))
);

create table public.app_integrations (
  provider text not null,
  data jsonb default '{}'::jsonb not null,
  updated_at timestamp with time zone default now() not null,
  constraint app_integrations_pkey PRIMARY KEY (provider)
);

create table public.contractor_invites (
  id uuid default gen_random_uuid() not null,
  token text not null,
  phone text not null,
  full_name text,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  expires_at timestamp with time zone not null,
  used_at timestamp with time zone,
  used_by uuid,
  revoked_at timestamp with time zone,
  opened_at timestamp with time zone,
  open_count integer default 0 not null,
  constraint contractor_invites_pkey PRIMARY KEY (id),
  constraint contractor_invites_token_key UNIQUE (token),
  constraint contractor_invites_created_by_fkey FOREIGN KEY (created_by) REFERENCES staff(id) ON DELETE SET NULL,
  constraint contractor_invites_used_by_fkey FOREIGN KEY (used_by) REFERENCES staff(id) ON DELETE SET NULL
);

create table public.fee_settlements (
  id uuid default gen_random_uuid() not null,
  staff_id uuid not null,
  quote_id uuid,
  amount_cents integer not null,
  method text not null,
  note text,
  recorded_by uuid,
  created_at timestamp with time zone default now() not null,
  constraint fee_settlements_pkey PRIMARY KEY (id),
  constraint fee_settlements_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES quote_requests(id) ON DELETE SET NULL,
  constraint fee_settlements_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES staff(id) ON DELETE SET NULL,
  constraint fee_settlements_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE,
  constraint fs_chk CHECK (((amount_cents > 0) AND (amount_cents <= 100000000) AND (method = ANY (ARRAY['cash'::text, 'venmo'::text, 'zelle'::text, 'check'::text, 'card'::text, 'other'::text])) AND ((note IS NULL) OR (char_length(note) <= 500))))
);

create table public.job_staff_views (
  quote_id uuid not null,
  staff_id uuid not null,
  view_count integer default 0 not null,
  first_viewed_at timestamp with time zone default now() not null,
  last_viewed_at timestamp with time zone default now() not null,
  closed_view_count integer default 0 not null,
  last_closed_view_at timestamp with time zone,
  constraint job_staff_views_pkey PRIMARY KEY (quote_id, staff_id),
  constraint job_staff_views_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES quote_requests(id) ON DELETE CASCADE,
  constraint job_staff_views_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
);

create table public.login_attempts (
  id uuid default gen_random_uuid() not null,
  created_at timestamp with time zone default now() not null,
  email text,
  success boolean not null,
  reason text not null,
  staff_id uuid,
  ip text,
  user_agent text,
  constraint login_attempts_pkey PRIMARY KEY (id),
  constraint login_attempts_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE SET NULL
);

create table public.quote_drafts (
  submission_id uuid not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  name text,
  phone text,
  email text,
  address text,
  mode text,
  service text,
  step text,
  source_path text,
  lead_id uuid,
  left_at timestamp with time zone,
  alerted_at timestamp with time zone,
  dismissed_at timestamp with time zone,
  constraint quote_drafts_pkey PRIMARY KEY (submission_id)
);

create table public.quote_events (
  id uuid default gen_random_uuid() not null,
  quote_id uuid not null,
  type text not null,
  meta jsonb,
  actor uuid,
  created_at timestamp with time zone default now() not null,
  constraint quote_events_pkey PRIMARY KEY (id),
  constraint quote_events_actor_fkey FOREIGN KEY (actor) REFERENCES staff(id) ON DELETE SET NULL,
  constraint quote_events_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES quote_requests(id) ON DELETE CASCADE
);

create table public.quote_messages (
  id uuid default gen_random_uuid() not null,
  quote_id uuid,
  created_at timestamp with time zone default now() not null,
  kind text not null,
  role text not null,
  to_phone text,
  body text,
  ok boolean default false not null,
  provider text,
  status integer,
  detail text,
  send_after timestamp with time zone,
  sent_at timestamp with time zone,
  cancelled_at timestamp with time zone,
  attempts integer default 0 not null,
  constraint quote_messages_pkey PRIMARY KEY (id),
  constraint quote_messages_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES quote_requests(id) ON DELETE CASCADE
);

create table public.quote_options (
  id uuid default gen_random_uuid() not null,
  quote_id uuid not null,
  title text not null,
  description text,
  amount numeric(10,2) default 0 not null,
  required boolean default false not null,
  sort_order integer default 0 not null,
  customer_response text,
  responded_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint quote_options_pkey PRIMARY KEY (id),
  constraint quote_options_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES quote_requests(id) ON DELETE CASCADE,
  constraint qo_chk CHECK ((((char_length(title) >= 1) AND (char_length(title) <= 120)) AND ((description IS NULL) OR (char_length(description) <= 2000)) AND (amount >= (0)::numeric) AND (amount <= (99999999)::numeric) AND ((customer_response IS NULL) OR (customer_response = ANY (ARRAY['accepted'::text, 'declined'::text])))))
);

create table public.quote_packages (
  id uuid default gen_random_uuid() not null,
  quote_id uuid not null,
  title text not null,
  description text,
  amount numeric(10,2) default 0 not null,
  recommended boolean default false not null,
  sort_order integer default 0 not null,
  customer_response text,
  responded_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint quote_packages_pkey PRIMARY KEY (id),
  constraint quote_packages_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES quote_requests(id) ON DELETE CASCADE,
  constraint qp_chk CHECK ((((char_length(title) >= 1) AND (char_length(title) <= 120)) AND ((description IS NULL) OR (char_length(description) <= 2000)) AND (amount >= (0)::numeric) AND (amount <= (99999999)::numeric) AND ((customer_response IS NULL) OR (customer_response = ANY (ARRAY['accepted'::text, 'declined'::text])))))
);

create table public.quote_payments (
  id uuid default gen_random_uuid() not null,
  quote_id uuid not null,
  method text not null,
  amount_cents integer not null,
  fee_cents integer default 0 not null,
  status text default 'pending'::text not null,
  stripe_account_id text,
  checkout_session_id text,
  payment_intent_id text,
  refunded_cents integer default 0 not null,
  recorded_by uuid,
  note text,
  created_at timestamp with time zone default now() not null,
  paid_at timestamp with time zone,
  refunded_at timestamp with time zone,
  constraint quote_payments_pkey PRIMARY KEY (id),
  constraint quote_payments_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES quote_requests(id) ON DELETE CASCADE,
  constraint quote_payments_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES staff(id) ON DELETE SET NULL,
  constraint qp_chk CHECK (((method = ANY (ARRAY['card'::text, 'cash'::text, 'venmo'::text, 'zelle'::text, 'check'::text, 'other'::text])) AND (status = ANY (ARRAY['pending'::text, 'paid'::text, 'failed'::text, 'refunded'::text, 'voided'::text])) AND (amount_cents > 0) AND (amount_cents <= 100000000) AND (fee_cents >= 0) AND (fee_cents < amount_cents) AND (refunded_cents >= 0) AND (refunded_cents <= amount_cents) AND ((note IS NULL) OR (char_length(note) <= 500))))
);

create table public.quote_requests (
  id uuid default gen_random_uuid() not null,
  created_at timestamp with time zone default now() not null,
  name text not null,
  phone text not null,
  email text,
  service text,
  address text,
  city text,
  details text,
  quote_type text,
  preferred_time text,
  file_urls jsonb,
  source_path text,
  status text default 'new'::text not null,
  assigned_to uuid,
  quote_amount numeric(10,2),
  quote_summary text,
  internal_notes text,
  public_token text default replace((gen_random_uuid())::text, '-'::text, ''::text),
  job_token text default replace((gen_random_uuid())::text, '-'::text, ''::text),
  viewed_at timestamp with time zone,
  view_count integer default 0 not null,
  quote_sent_at timestamp with time zone,
  updated_at timestamp with time zone default now() not null,
  customer_response text,
  customer_responded_at timestamp with time zone,
  scheduled_date date,
  discount_accepted boolean default false not null,
  visit_date date,
  visit_time text,
  gcal_event_id text,
  reminder_sent_at timestamp with time zone,
  confirmed_at timestamp with time zone,
  completed_at timestamp with time zone,
  paid_at timestamp with time zone,
  payment_requested_at timestamp with time zone,
  archived_at timestamp with time zone,
  preferred_dates text[],
  scheduled_by uuid,
  scheduled_at timestamp with time zone,
  scheduled_time text,
  crew_reminders text[],
  stale_lead_reminded_at timestamp with time zone,
  visit_reminder_sent_at timestamp with time zone,
  visit_crew_reminded_at timestamp with time zone,
  quote_followup_sent_at timestamp with time zone,
  quote_scope text,
  quote_permits text,
  quote_prep text,
  quote_pour text,
  quote_cleanup text,
  quote_expires_at timestamp with time zone,
  internal_urls text[],
  before_urls text[],
  after_urls text[],
  preferred_times text[],
  fee_rate numeric(5,4),
  fee_total_cents integer,
  is_test boolean default false not null,
  client_submission_id text,
  change_note text,
  change_amount numeric(10,2),
  change_requested_at timestamp with time zone,
  change_requested_by uuid,
  change_lines jsonb,
  change_deposit_cents integer,
  deposit_target_cents integer,
  fee_waived_cents integer default 0 not null,
  fee_waived_note text,
  constraint quote_requests_pkey PRIMARY KEY (id),
  constraint quote_requests_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES staff(id) ON DELETE SET NULL,
  constraint quote_requests_change_requested_by_fkey FOREIGN KEY (change_requested_by) REFERENCES staff(id) ON DELETE SET NULL,
  constraint quote_requests_scheduled_by_fkey FOREIGN KEY (scheduled_by) REFERENCES staff(id) ON DELETE SET NULL,
  constraint qr_chk CHECK ((((char_length(name) >= 1) AND (char_length(name) <= 120)) AND ((char_length(phone) >= 7) AND (char_length(phone) <= 32)) AND ((email IS NULL) OR ((char_length(email) <= 200) AND (email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'::text))) AND ((service IS NULL) OR (char_length(service) <= 120)) AND ((address IS NULL) OR (char_length(address) <= 300)) AND ((city IS NULL) OR (char_length(city) <= 120)) AND ((details IS NULL) OR (char_length(details) <= 2000)) AND ((preferred_time IS NULL) OR (char_length(preferred_time) <= 120)) AND ((quote_type IS NULL) OR (quote_type = ANY (ARRAY['online'::text, 'inperson'::text, 'plans'::text]))) AND ((file_urls IS NULL) OR (jsonb_typeof(file_urls) = 'array'::text)))),
  constraint qr_customer_response_chk CHECK (((customer_response IS NULL) OR (customer_response = ANY (ARRAY['accepted'::text, 'declined'::text])))),
  constraint qr_sections_chk CHECK ((((quote_scope IS NULL) OR (char_length(quote_scope) <= 2000)) AND ((quote_permits IS NULL) OR (char_length(quote_permits) <= 2000)) AND ((quote_prep IS NULL) OR (char_length(quote_prep) <= 2000)) AND ((quote_pour IS NULL) OR (char_length(quote_pour) <= 2000)) AND ((quote_cleanup IS NULL) OR (char_length(quote_cleanup) <= 2000)))),
  constraint qr_status_chk CHECK ((status = ANY (ARRAY['new'::text, 'quoted'::text, 'approved'::text, 'scheduled'::text, 'completed'::text, 'paid'::text, 'lost'::text]))),
  constraint quote_requests_change_amount_sane CHECK (((change_amount IS NULL) OR ((change_amount >= (0)::numeric) AND (change_amount <= (99999999)::numeric)))),
  constraint quote_requests_change_complete CHECK ((((change_requested_at IS NULL) AND (change_amount IS NULL) AND (change_note IS NULL)) OR ((change_requested_at IS NOT NULL) AND (change_amount IS NOT NULL) AND (change_note IS NOT NULL)))),
  constraint quote_requests_change_deposit_sane CHECK (((change_deposit_cents IS NULL) OR ((change_requested_at IS NOT NULL) AND (change_deposit_cents > 0) AND (change_deposit_cents <= '9999999999'::bigint)))),
  constraint quote_requests_change_lines_sane CHECK (((change_lines IS NULL) OR ((change_requested_at IS NOT NULL) AND (jsonb_typeof(change_lines) = 'array'::text) AND (jsonb_array_length(change_lines) <= 12)))),
  constraint quote_requests_deposit_target_sane CHECK (((deposit_target_cents IS NULL) OR ((deposit_target_cents >= 0) AND (deposit_target_cents <= '9999999999'::bigint)))),
  constraint quote_requests_fee_waived_sane CHECK (((fee_waived_cents >= 0) AND (fee_waived_cents <= '9999999999'::bigint)))
);

create table public.site_funnel_events (
  id bigint generated always as identity not null,
  created_at timestamp with time zone default now() not null,
  attempt_id text not null,
  visitor_id text not null,
  form text not null,
  event text not null,
  step text,
  ms integer,
  mode text,
  detail text,
  path text,
  device text,
  constraint site_funnel_events_pkey PRIMARY KEY (id),
  constraint site_funnel_events_event_check CHECK ((event = ANY (ARRAY['open'::text, 'view'::text, 'done'::text, 'back'::text, 'close'::text, 'error'::text, 'submit'::text]))),
  constraint site_funnel_events_form_check CHECK ((form = ANY (ARRAY['modal'::text, 'estimate'::text])))
);

create table public.staff (
  id uuid not null,
  email text,
  full_name text,
  phone text,
  role text default 'contractor'::text not null,
  active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  must_reset_password boolean default false not null,
  locale text default 'en'::text not null,
  service_types text[],
  work_start_hour integer default 8 not null,
  work_end_hour integer default 16 not null,
  work_days integer[] default '{0,1,2,3,4,5,6}'::integer[] not null,
  stripe_account_id text,
  stripe_charges_enabled boolean default false not null,
  stripe_payouts_enabled boolean default false not null,
  stripe_details_submitted boolean default false not null,
  stripe_checked_at timestamp with time zone,
  is_test boolean default false not null,
  constraint staff_pkey PRIMARY KEY (id),
  constraint staff_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint staff_locale_chk CHECK ((locale = ANY (ARRAY['en'::text, 'es'::text]))),
  constraint staff_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'contractor'::text]))),
  constraint staff_work_hours_chk CHECK ((((work_start_hour >= 5) AND (work_start_hour <= 21)) AND ((work_end_hour >= 5) AND (work_end_hour <= 21)) AND (work_end_hour >= work_start_hour)))
);

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Indexes (other than primary keys and unique constraints above)
-- ════════════════════════════════════════════════════════════════════════════

CREATE INDEX ag_created_idx ON public.agreements USING btree (created_at DESC);
CREATE INDEX ag_quote_idx ON public.agreements USING btree (quote_id);
CREATE INDEX ag_staff_idx ON public.agreements USING btree (staff_id);
CREATE INDEX ag_status_idx ON public.agreements USING btree (status);
CREATE INDEX ci_created_idx ON public.contractor_invites USING btree (created_at DESC);
CREATE INDEX ci_token_idx ON public.contractor_invites USING btree (token);
CREATE INDEX fs_staff_idx ON public.fee_settlements USING btree (staff_id, created_at DESC);
CREATE INDEX la_created_idx ON public.login_attempts USING btree (created_at DESC);
CREATE INDEX la_email_idx ON public.login_attempts USING btree (email);
CREATE INDEX la_ip_idx ON public.login_attempts USING btree (ip);
CREATE INDEX quote_drafts_updated_at_idx ON public.quote_drafts USING btree (updated_at DESC);
CREATE INDEX qe_quote_idx ON public.quote_events USING btree (quote_id);
CREATE INDEX qm_due_idx ON public.quote_messages USING btree (send_after) WHERE ((send_after IS NOT NULL) AND (sent_at IS NULL) AND (cancelled_at IS NULL));
CREATE INDEX qm_phone_idx ON public.quote_messages USING btree (to_phone);
CREATE INDEX qm_quote_idx ON public.quote_messages USING btree (quote_id, created_at DESC);
CREATE INDEX qo_quote_idx ON public.quote_options USING btree (quote_id, sort_order);
CREATE UNIQUE INDEX qp_one_recommended ON public.quote_packages USING btree (quote_id) WHERE recommended;
CREATE INDEX qp_account_idx ON public.quote_payments USING btree (stripe_account_id);
CREATE INDEX qp_paid_idx ON public.quote_payments USING btree (paid_at DESC) WHERE (status = 'paid'::text);
CREATE INDEX qp_quote_idx ON public.quote_payments USING btree (quote_id, created_at DESC);
CREATE UNIQUE INDEX qp_session_idx ON public.quote_payments USING btree (checkout_session_id) WHERE (checkout_session_id IS NOT NULL);
CREATE INDEX qr_archived_idx ON public.quote_requests USING btree (archived_at);
CREATE INDEX qr_assigned_idx ON public.quote_requests USING btree (assigned_to);
CREATE UNIQUE INDEX qr_client_submission_id_key ON public.quote_requests USING btree (client_submission_id) WHERE (client_submission_id IS NOT NULL);
CREATE INDEX qr_is_test_idx ON public.quote_requests USING btree (is_test) WHERE is_test;
CREATE UNIQUE INDEX qr_job_token_idx ON public.quote_requests USING btree (job_token);
CREATE UNIQUE INDEX qr_one_job_per_day ON public.quote_requests USING btree (scheduled_date) WHERE ((customer_response = 'accepted'::text) AND (status <> 'lost'::text));
CREATE UNIQUE INDEX qr_public_token_idx ON public.quote_requests USING btree (public_token);
CREATE INDEX qr_scheduled_date_idx ON public.quote_requests USING btree (scheduled_date);
CREATE INDEX qr_status_idx ON public.quote_requests USING btree (status);
CREATE INDEX qr_visit_date_idx ON public.quote_requests USING btree (visit_date);
CREATE INDEX site_funnel_events_created_at_idx ON public.site_funnel_events USING btree (created_at DESC);
CREATE UNIQUE INDEX staff_stripe_account_idx ON public.staff USING btree (stripe_account_id) WHERE (stripe_account_id IS NOT NULL);

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Row level security: enabled on every table, forced on none
-- ════════════════════════════════════════════════════════════════════════════

alter table public.agreements enable row level security;
alter table public.app_integrations enable row level security;
alter table public.contractor_invites enable row level security;
alter table public.fee_settlements enable row level security;
alter table public.job_staff_views enable row level security;
alter table public.login_attempts enable row level security;
alter table public.quote_drafts enable row level security;
alter table public.quote_events enable row level security;
alter table public.quote_messages enable row level security;
alter table public.quote_options enable row level security;
alter table public.quote_packages enable row level security;
alter table public.quote_payments enable row level security;
alter table public.quote_requests enable row level security;
alter table public.site_funnel_events enable row level security;
alter table public.staff enable row level security;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Policies (pg_policies). Tables with RLS on and no policy here are
--    service-role only: app_integrations, quote_drafts, site_funnel_events.
-- ════════════════════════════════════════════════════════════════════════════

create policy "owner writes agreements" on public.agreements as permissive for all to authenticated
  using (is_owner())
  with check (is_owner());

create policy "staff read agreements" on public.agreements as permissive for select to authenticated
  using ((is_owner() OR (staff_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM quote_requests q
  WHERE ((q.id = agreements.quote_id) AND (q.assigned_to = auth.uid()))))));

create policy "owner reads invites" on public.contractor_invites as permissive for select to authenticated
  using (is_owner());

create policy "owner insert settlements" on public.fee_settlements as permissive for insert to authenticated
  with check (is_owner());

create policy "owner read settlements" on public.fee_settlements as permissive for select to authenticated
  using (is_owner());

create policy "owner reads crew views" on public.job_staff_views as permissive for select to authenticated
  using (is_owner());

create policy "owner reads login attempts" on public.login_attempts as permissive for select to authenticated
  using (is_owner());

create policy "staff insert events" on public.quote_events as permissive for insert to authenticated
  with check ((is_owner() OR (EXISTS ( SELECT 1
   FROM quote_requests q
  WHERE ((q.id = quote_events.quote_id) AND (q.assigned_to = auth.uid()))))));

create policy "staff read events" on public.quote_events as permissive for select to authenticated
  using ((is_owner() OR (EXISTS ( SELECT 1
   FROM quote_requests q
  WHERE ((q.id = quote_events.quote_id) AND (q.assigned_to = auth.uid()))))));

create policy "staff read messages" on public.quote_messages as permissive for select to authenticated
  using ((is_owner() OR (EXISTS ( SELECT 1
   FROM quote_requests q
  WHERE ((q.id = quote_messages.quote_id) AND (q.assigned_to = auth.uid()))))));

create policy "staff delete options" on public.quote_options as permissive for delete to authenticated
  using ((is_owner() OR (EXISTS ( SELECT 1
   FROM quote_requests q
  WHERE ((q.id = quote_options.quote_id) AND (q.assigned_to = auth.uid()))))));

create policy "staff insert options" on public.quote_options as permissive for insert to authenticated
  with check ((is_owner() OR (EXISTS ( SELECT 1
   FROM quote_requests q
  WHERE ((q.id = quote_options.quote_id) AND (q.assigned_to = auth.uid()))))));

create policy "staff read options" on public.quote_options as permissive for select to authenticated
  using ((is_owner() OR (EXISTS ( SELECT 1
   FROM quote_requests q
  WHERE ((q.id = quote_options.quote_id) AND (q.assigned_to = auth.uid()))))));

create policy "staff update options" on public.quote_options as permissive for update to authenticated
  using ((is_owner() OR (EXISTS ( SELECT 1
   FROM quote_requests q
  WHERE ((q.id = quote_options.quote_id) AND (q.assigned_to = auth.uid()))))))
  with check ((is_owner() OR (EXISTS ( SELECT 1
   FROM quote_requests q
  WHERE ((q.id = quote_options.quote_id) AND (q.assigned_to = auth.uid()))))));

create policy "staff delete packages" on public.quote_packages as permissive for delete to authenticated
  using ((is_owner() OR (EXISTS ( SELECT 1
   FROM quote_requests q
  WHERE ((q.id = quote_packages.quote_id) AND (q.assigned_to = auth.uid()))))));

create policy "staff insert packages" on public.quote_packages as permissive for insert to authenticated
  with check ((is_owner() OR (EXISTS ( SELECT 1
   FROM quote_requests q
  WHERE ((q.id = quote_packages.quote_id) AND (q.assigned_to = auth.uid()))))));

create policy "staff read packages" on public.quote_packages as permissive for select to authenticated
  using ((is_owner() OR (EXISTS ( SELECT 1
   FROM quote_requests q
  WHERE ((q.id = quote_packages.quote_id) AND (q.assigned_to = auth.uid()))))));

create policy "staff update packages" on public.quote_packages as permissive for update to authenticated
  using ((is_owner() OR (EXISTS ( SELECT 1
   FROM quote_requests q
  WHERE ((q.id = quote_packages.quote_id) AND (q.assigned_to = auth.uid()))))))
  with check ((is_owner() OR (EXISTS ( SELECT 1
   FROM quote_requests q
  WHERE ((q.id = quote_packages.quote_id) AND (q.assigned_to = auth.uid()))))));

create policy "staff insert payments" on public.quote_payments as permissive for insert to authenticated
  with check (((is_owner() OR (EXISTS ( SELECT 1
   FROM quote_requests q
  WHERE ((q.id = quote_payments.quote_id) AND (q.assigned_to = auth.uid()))))) AND (method <> 'card'::text) AND (fee_cents = 0) AND (status = 'paid'::text) AND (recorded_by = auth.uid()) AND (stripe_account_id IS NULL) AND (checkout_session_id IS NULL) AND (payment_intent_id IS NULL) AND (refunded_cents = 0)));

create policy "staff read payments" on public.quote_payments as permissive for select to authenticated
  using ((is_owner() OR (EXISTS ( SELECT 1
   FROM quote_requests q
  WHERE ((q.id = quote_payments.quote_id) AND (q.assigned_to = auth.uid()))))));

create policy "contractor updates assigned" on public.quote_requests as permissive for update to authenticated
  using ((assigned_to = auth.uid()))
  with check ((assigned_to = auth.uid()));

create policy "owner inserts quotes" on public.quote_requests as permissive for insert to authenticated
  with check (is_owner());

create policy "owner updates quotes" on public.quote_requests as permissive for update to authenticated
  using (is_owner())
  with check (is_owner());

create policy "staff read quotes" on public.quote_requests as permissive for select to authenticated
  using ((is_owner() OR ((assigned_to = auth.uid()) AND (status <> 'lost'::text) AND (archived_at IS NULL))));

create policy "owner manages staff" on public.staff as permissive for all to authenticated
  using (is_owner())
  with check (is_owner());

create policy "staff self or owner read" on public.staff as permissive for select to authenticated
  using (((id = auth.uid()) OR is_owner()));

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Functions (pg_get_functiondef). All owned by postgres.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.apply_change_response(p_id uuid, p_accept boolean, p_requested_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_at timestamptz;
begin
  select change_requested_at into v_at from public.quote_requests where id = p_id for update;
  if found and v_at is not null and p_requested_at is not null and v_at is distinct from p_requested_at then
    return jsonb_build_object('status', 'stale');
  end if;
  return public.apply_change_response_core(p_id, p_accept);
end;
$function$
;

-- The pre-stage-1 apply_change_response (change-deposit.sql body), renamed by stage 1.
CREATE OR REPLACE FUNCTION public.apply_change_response_core(p_id uuid, p_accept boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  q public.quote_requests;
  v_from numeric; v_to numeric; v_note text; v_lines jsonb; v_old jsonb; v_sum numeric;
  v_deposit integer; v_paid bigint;
begin
  select * into q from public.quote_requests where id = p_id for update;
  if not found or q.change_requested_at is null or q.change_amount is null then
    return jsonb_build_object('status', 'none');
  end if;
  v_from := q.quote_amount; v_to := q.change_amount; v_note := q.change_note; v_lines := q.change_lines;
  v_deposit := q.change_deposit_cents;
  select coalesce(jsonb_agg(jsonb_build_object('title', o.title, 'description', o.description, 'amount', o.amount,
           'required', o.required, 'customer_response', o.customer_response) order by o.sort_order, o.created_at), '[]'::jsonb)
    into v_old from public.quote_options o where o.quote_id = p_id;
  if p_accept and v_lines is not null then
    if jsonb_array_length(v_lines) > 0 then
      select coalesce(sum((l->>'amount')::numeric), 0) into v_sum from jsonb_array_elements(v_lines) l;
      if round(v_sum, 2) <> round(v_to, 2) then
        raise exception 'change lines (%) do not add up to the new total (%)', v_sum, v_to;
      end if;
    end if;
    delete from public.quote_options where quote_id = p_id;
    insert into public.quote_options (quote_id, title, description, amount, required, sort_order, customer_response, responded_at)
    select p_id, l->>'title', nullif(l->>'description', ''), (l->>'amount')::numeric, true, (t.ord - 1)::int, 'accepted', now()
    from jsonb_array_elements(v_lines) with ordinality as t(l, ord);
  end if;
  select coalesce(sum(p.amount_cents - p.refunded_cents), 0) into v_paid
    from public.quote_payments p where p.quote_id = p_id and p.status in ('paid', 'refunded');
  update public.quote_requests set
    quote_amount = case when p_accept then v_to else quote_amount end,
    deposit_target_cents = case when p_accept and v_deposit is not null then (v_paid + v_deposit)::int else deposit_target_cents end,
    change_note = null, change_amount = null, change_requested_at = null, change_requested_by = null,
    change_lines = null, change_deposit_cents = null
  where id = p_id returning * into q;
  return jsonb_build_object('status', 'ok', 'quote', to_jsonb(q), 'from', v_from, 'to', v_to, 'note', v_note,
    'old_lines', v_old, 'new_lines', v_lines, 'deposit_cents', case when p_accept then v_deposit else null end,
    'paid_cents', v_paid);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.bump_job_staff_view(p_quote uuid, p_staff uuid)
 RETURNS void
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$select public.bump_job_staff_view(p_quote, p_staff, false)$function$
;

CREATE OR REPLACE FUNCTION public.bump_job_staff_view(p_quote uuid, p_staff uuid, p_closed boolean DEFAULT false)
 RETURNS void
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$insert into public.job_staff_views (quote_id, staff_id, view_count, closed_view_count, last_closed_view_at) values (p_quote, p_staff, 1, case when p_closed then 1 else 0 end, case when p_closed then now() end) on conflict (quote_id, staff_id) do update set view_count = job_staff_views.view_count + 1, last_viewed_at = now(), closed_view_count = job_staff_views.closed_view_count + case when p_closed then 1 else 0 end, last_closed_view_at = case when p_closed then now() else job_staff_views.last_closed_view_at end$function$
;

-- Stored with CRLF line endings.
CREATE OR REPLACE FUNCTION public.guard_payment_not_over_total()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  total_cents  integer;
  already_cents integer;
begin
  if auth.uid() is null or new.status <> 'paid' then
    return new;
  end if;

  select round(coalesce(q.quote_amount, 0) * 100)::integer
    into total_cents
    from public.quote_requests q
   where q.id = new.quote_id;

  -- No price on the job yet: the app refuses this case with a better message,
  -- and there is no total here to measure an overpayment against.
  if total_cents is null or total_cents <= 0 then
    return new;
  end if;

  select coalesce(sum(p.amount_cents - p.refunded_cents), 0)
    into already_cents
    from public.quote_payments p
   where p.quote_id = new.quote_id
     and p.status in ('paid', 'refunded');

  if already_cents + new.amount_cents > total_cents then
    raise exception 'that is more than the % cents still owed on this job',
      greatest(total_cents - already_cents, 0)
      using errcode = '23514';
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.guard_quote_line_prices()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  jobs uuid[];
begin
  if auth.uid() is null or public.is_owner() then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.amount is not distinct from old.amount
       and new.quote_id is not distinct from old.quote_id then
      return new;
    end if;
    jobs := array[old.quote_id, new.quote_id];
  elsif tg_op = 'INSERT' then
    jobs := array[new.quote_id];
  else
    jobs := array[old.quote_id];
  end if;

  if exists (
    select 1 from public.quote_requests q
     where q.id = any(jobs)
       and (q.customer_response = 'accepted'
            or (q.customer_response = 'declined' and q.status = 'lost'))
  ) then
    raise exception 'the customer has approved this price; send a change order for them to approve'
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.guard_quote_money_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  answered boolean;
begin
  if auth.uid() is null or public.is_owner() then
    return new;
  end if;

  answered := coalesce(old.customer_response = 'accepted', false)
              or coalesce(old.customer_response = 'declined' and old.status = 'lost', false);

  if new.fee_rate is distinct from old.fee_rate
     or new.fee_total_cents is distinct from old.fee_total_cents
     or new.fee_waived_cents is distinct from old.fee_waived_cents
     or new.fee_waived_note is distinct from old.fee_waived_note then
    raise exception 'the office fee is set by the office'
      using errcode = '42501';
  end if;

  if new.is_test is distinct from old.is_test then
    raise exception 'is_test is set by the office' using errcode = '42501';
  end if;

  if new.archived_at is distinct from old.archived_at then
    raise exception 'archiving a lead is done by the office' using errcode = '42501';
  end if;

  if new.status is distinct from old.status
     and (new.status = 'paid' or old.status = 'paid') then
    raise exception 'only the office can mark a job paid, or move it off paid'
      using errcode = '42501';
  end if;
  if new.paid_at is distinct from old.paid_at then
    raise exception 'paid_at is set from the payments ledger' using errcode = '42501';
  end if;

  if new.deposit_target_cents is distinct from old.deposit_target_cents then
    raise exception 'the deposit is set by an approved change order' using errcode = '42501';
  end if;

  if new.phone is distinct from old.phone or new.email is distinct from old.email then
    raise exception 'the customer''s phone and email are changed by the office'
      using errcode = '42501';
  end if;

  if answered then
    if new.quote_amount is distinct from old.quote_amount
       or new.discount_accepted is distinct from old.discount_accepted then
      raise exception 'the customer has approved this price; send a change order for them to approve'
        using errcode = '42501';
    end if;

    if new.customer_response is distinct from old.customer_response
       or new.customer_responded_at is distinct from old.customer_responded_at then
      raise exception 'the customer''s answer is on file and only the office can change it'
        using errcode = '42501';
    end if;
  end if;

  if old.change_requested_at is not null
     and row(new.change_note, new.change_amount, new.change_requested_at,
             new.change_requested_by, new.change_lines, new.change_deposit_cents)
         is distinct from
         row(old.change_note, old.change_amount, old.change_requested_at,
             old.change_requested_by, old.change_lines, old.change_deposit_cents)
     and not (new.change_note is null and new.change_amount is null
              and new.change_requested_at is null and new.change_requested_by is null
              and new.change_lines is null and new.change_deposit_cents is null) then
    raise exception 'a change is already waiting on the customer; withdraw it first'
      using errcode = '42501';
  end if;

  if old.change_requested_at is null and new.change_requested_at is not null then
    if new.change_requested_by is distinct from auth.uid() then
      raise exception 'a change order is sent in your own name' using errcode = '42501';
    end if;
    if round(coalesce(new.change_amount, 0) * 100) < round(coalesce(old.quote_amount, 0) * 100) then
      raise exception 'lowering an approved price is done by the office' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$function$
;

-- Stored with CRLF line endings.
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.staff (id, email, full_name, role, active)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''), 'contractor', false)
  on conflict (id) do nothing;
  return new;
end;
$function$
;

-- Stored with CRLF line endings.
CREATE OR REPLACE FUNCTION public.is_owner()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.staff s
    where s.id = auth.uid() and s.role = 'owner' and s.active
  );
$function$
;

-- Stored with CRLF line endings.
CREATE OR REPLACE FUNCTION public.touch_agreements_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;

-- Stored with CRLF line endings.
CREATE OR REPLACE FUNCTION public.touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. Triggers (pg_get_triggerdef). All enabled except send_to_make.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();
CREATE TRIGGER agreements_touch_updated_at BEFORE UPDATE ON public.agreements FOR EACH ROW EXECUTE FUNCTION touch_agreements_updated_at();
CREATE TRIGGER qo_guard_line_prices BEFORE INSERT OR DELETE OR UPDATE ON public.quote_options FOR EACH ROW EXECUTE FUNCTION guard_quote_line_prices();
CREATE TRIGGER qo_touch_updated_at BEFORE UPDATE ON public.quote_options FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER qp_guard_line_prices BEFORE INSERT OR DELETE OR UPDATE ON public.quote_packages FOR EACH ROW EXECUTE FUNCTION guard_quote_line_prices();
CREATE TRIGGER qp_touch_updated_at BEFORE UPDATE ON public.quote_packages FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER qp_guard_over_total BEFORE INSERT ON public.quote_payments FOR EACH ROW EXECUTE FUNCTION guard_payment_not_over_total();
CREATE TRIGGER qr_guard_money_columns BEFORE UPDATE ON public.quote_requests FOR EACH ROW EXECUTE FUNCTION guard_quote_money_columns();
CREATE TRIGGER qr_touch_updated_at BEFORE UPDATE ON public.quote_requests FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Created from the dashboard (Database Webhooks), not from any file in this repo.
CREATE TRIGGER send_to_make AFTER INSERT ON public.quote_requests FOR EACH ROW EXECUTE FUNCTION supabase_functions.http_request('<redacted>', 'POST', '{"Content-type":"application/json"}', '{}', '5000');
alter table public.quote_requests disable trigger send_to_make;

-- ════════════════════════════════════════════════════════════════════════════
-- 7. Grants
-- ════════════════════════════════════════════════════════════════════════════

-- Schema: USAGE on public for PUBLIC, anon, authenticated, service_role.

-- Tables. The default privileges of role postgres in this project give anon,
-- authenticated and service_role TRUNCATE, REFERENCES, TRIGGER and MAINTAIN on
-- every new table; the rows marked (default) below are that, left in place.
-- PostgREST never issues them, but TRUNCATE ignores RLS for any direct SQL
-- session in those roles.
grant truncate, references, trigger, maintain on public.agreements to anon;                          -- (default)
grant select, insert, update, delete, truncate, references, trigger, maintain on public.agreements to authenticated;
grant select, insert, update, delete, truncate, references, trigger, maintain on public.agreements to service_role;

grant truncate, references, trigger, maintain on public.app_integrations to anon, authenticated;     -- (default)
grant select, insert, update, delete, truncate, references, trigger, maintain on public.app_integrations to service_role;

grant truncate, references, trigger, maintain on public.contractor_invites to anon;                  -- (default)
grant select, truncate, references, trigger, maintain on public.contractor_invites to authenticated;
grant select, insert, update, delete, truncate, references, trigger, maintain on public.contractor_invites to service_role;

grant truncate, references, trigger, maintain on public.fee_settlements to anon;                     -- (default)
grant select, insert, truncate, references, trigger, maintain on public.fee_settlements to authenticated;
grant select, insert, update, delete, truncate, references, trigger, maintain on public.fee_settlements to service_role;

grant truncate, references, trigger, maintain on public.job_staff_views to anon;                     -- (default)
grant select, truncate, references, trigger, maintain on public.job_staff_views to authenticated;
grant select, insert, update, truncate, references, trigger, maintain on public.job_staff_views to service_role;

grant truncate, references, trigger, maintain on public.login_attempts to anon;                      -- (default)
grant select, truncate, references, trigger, maintain on public.login_attempts to authenticated;
grant select, insert, update, delete, truncate, references, trigger, maintain on public.login_attempts to service_role;

-- quote_drafts: nothing for anon or authenticated.
grant select, insert, update, truncate, references, trigger, maintain on public.quote_drafts to service_role;

grant truncate, references, trigger, maintain on public.quote_events to anon;                        -- (default)
grant select, insert, truncate, references, trigger, maintain on public.quote_events to authenticated;
grant select, insert, update, delete, truncate, references, trigger, maintain on public.quote_events to service_role;

grant truncate, references, trigger, maintain on public.quote_messages to anon;                      -- (default)
grant select, truncate, references, trigger, maintain on public.quote_messages to authenticated;
grant select, insert, update, delete, truncate, references, trigger, maintain on public.quote_messages to service_role;

grant truncate, references, trigger, maintain on public.quote_options to anon;                       -- (default)
grant select, insert, update, delete, truncate, references, trigger, maintain on public.quote_options to authenticated;
grant select, insert, update, delete, truncate, references, trigger, maintain on public.quote_options to service_role;

grant truncate, references, trigger, maintain on public.quote_packages to anon;                      -- (default)
grant select, insert, update, delete, truncate, references, trigger, maintain on public.quote_packages to authenticated;
grant select, insert, update, delete, truncate, references, trigger, maintain on public.quote_packages to service_role;

-- quote_payments: no UPDATE or DELETE for authenticated (append-only ledger).
grant truncate, references, trigger, maintain on public.quote_payments to anon;                      -- (default)
grant select, insert, truncate, references, trigger, maintain on public.quote_payments to authenticated;
grant select, insert, update, delete, truncate, references, trigger, maintain on public.quote_payments to service_role;

-- quote_requests: nothing for anon; no DELETE for anyone but the owner role.
grant select, insert, update, truncate, references, trigger, maintain on public.quote_requests to authenticated;
grant select, insert, update, truncate, references, trigger, maintain on public.quote_requests to service_role;

-- site_funnel_events: nothing for anon or authenticated.
grant select, insert, truncate, references, trigger, maintain on public.site_funnel_events to service_role;
grant select, usage on sequence public.site_funnel_events_id_seq to service_role;

grant truncate, references, trigger, maintain on public.staff to anon;                               -- (default)
grant select, insert, update, delete, truncate, references, trigger, maintain on public.staff to authenticated;
grant select, insert, update, delete, truncate, references, trigger, maintain on public.staff to service_role;

-- No column-level grants.

-- Functions. EXECUTE as held today; every other role has none (PUBLIC revoked).
-- touch_updated_at() and touch_agreements_updated_at() keep the built-in default
-- (proacl NULL: EXECUTE for PUBLIC). New functions postgres creates in public get
-- EXECUTE for postgres only, so grant service_role/authenticated explicitly.
revoke all on function public.apply_change_response(uuid, boolean, timestamp with time zone) from public;
grant execute on function public.apply_change_response(uuid, boolean, timestamp with time zone) to service_role;
revoke all on function public.apply_change_response_core(uuid, boolean) from public;        -- postgres only
revoke all on function public.bump_job_staff_view(uuid, uuid, boolean) from public;
grant execute on function public.bump_job_staff_view(uuid, uuid, boolean) to service_role;
revoke all on function public.bump_job_staff_view(uuid, uuid) from public;
grant execute on function public.bump_job_staff_view(uuid, uuid) to service_role;
revoke all on function public.guard_payment_not_over_total() from public;                   -- postgres only
revoke all on function public.guard_quote_line_prices() from public;                        -- postgres only
revoke all on function public.guard_quote_money_columns() from public;                      -- postgres only
revoke all on function public.handle_new_user() from public;                                -- postgres only
revoke all on function public.is_owner() from public;
grant execute on function public.is_owner() to authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 8. Outside public, for context
-- ════════════════════════════════════════════════════════════════════════════
-- storage.buckets (private, no storage.objects policies; uploads use signed URLs):
--   quote-uploads  file_size_limit 52428800  image/jpeg, image/png, image/webp,
--                  image/heic, image/heif, image/heic-sequence, image/heif-sequence,
--                  image/gif, video/mp4, video/quicktime, video/webm, video/3gpp
--   agreements     file_size_limit 26214400  application/pdf, image/jpeg,
--                  image/png, image/heic, image/webp
-- Realtime publication supabase_realtime carries no public tables. No pg_cron.
