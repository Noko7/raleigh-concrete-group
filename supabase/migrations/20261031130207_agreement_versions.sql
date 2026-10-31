-- Raleigh Concrete Group - customer agreements written in the site, with every saved version kept
-- Undo: undo/20261031130207_agreement_versions.undo.sql. Check: verify/20261031130207_agreement_versions.verify.sql.
--
-- An agreement (public.agreements) is now drafted from the job and edited in the CRM. Every save is a new,
-- numbered version that is never changed or deleted afterwards, so the back-and-forth on a job is a complete
-- history: who saved what, when, with the exact document they saw.
--
--   1. staff.license_number and staff.payment_methods: printed on the agreement (the license line and "How you
--      pay"). payment_methods defaults to all four the business takes.
--   2. agreement_versions: one row per save.
--        * version_no: 1, 2, 3... per agreement with no gaps, assigned by the database under a lock on the
--          agreement row, so two people saving at once get 2 and 3, never two 2s.
--        * body: the editor's blocks and values (jsonb). html: the document rendered from it by the server, the
--          exact text that is previewed and later sent for signing. html_sha256: computed here, not sent by the
--          app, so the stored fingerprint always matches the stored text.
--        * created_by is the saver's staff id with no foreign key, and created_by_name a copy of their name, so
--          a version still says who saved it after that person's account is deleted (and deleting them never
--          has to touch a saved version).
--        * Rows are never edited or deleted through the API (no grant for it), and a trigger refuses any UPDATE
--          for every role, the service role included. They go only when their agreement does.
--        * Saving is done by the server only (service role), after it has checked the caller may edit this
--          job's agreement, re-read the body, put the job's own money in it and rendered the HTML itself. No
--          signed-in role can insert directly, so no HTML reaches this table any other way.
--   3. agreements.current_version_id: the latest version, set by the database on each save.
--   4. RLS: the owner reads versions of any agreement; a contractor reads versions of agreements on jobs
--      assigned to them and of their own onboarding agreement. Nothing for anon.

set local lock_timeout = '5s';

-- ── 1. Contractor details printed on the agreement ──────────────────────────
alter table public.staff add column if not exists license_number text;
alter table public.staff add column if not exists payment_methods text[] default '{zelle,venmo,check,cash}'::text[] not null;
alter table public.staff add constraint staff_agreement_fields_chk
  check ((license_number is null or char_length(license_number) <= 60)
     and cardinality(payment_methods) between 1 and 4
     and payment_methods <@ '{zelle,venmo,check,cash}'::text[]);

-- ── 2. Versions ─────────────────────────────────────────────────────────────
create table public.agreement_versions (
  id uuid default gen_random_uuid() not null,
  agreement_id uuid not null,
  version_no integer not null,
  template_version text not null,
  body jsonb not null,
  html text not null,
  html_sha256 text not null,
  note text,
  created_by uuid,
  created_by_name text,
  created_at timestamp with time zone default now() not null,
  constraint agreement_versions_pkey PRIMARY KEY (id),
  constraint agreement_versions_agreement_fkey FOREIGN KEY (agreement_id) REFERENCES agreements(id) ON DELETE CASCADE,
  constraint agreement_versions_no_key UNIQUE (agreement_id, version_no),
  constraint agreement_versions_chk CHECK (
    version_no >= 1
    and char_length(template_version) between 1 and 40
    and jsonb_typeof(body) = 'object'
    and char_length(html) between 1 and 500000
    and html_sha256 ~ '^[0-9a-f]{64}$'
    and (note is null or char_length(note) <= 300)
    and (created_by_name is null or char_length(created_by_name) <= 200)
  )
);
CREATE INDEX agreement_versions_agreement_idx ON public.agreement_versions USING btree (agreement_id, version_no DESC);

-- Numbers the version, stamps who and when, fingerprints the HTML. SECURITY DEFINER so the row lock works for a
-- contractor too (RLS would hide the agreement row from SELECT ... FOR UPDATE, and they cannot update it).
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
  -- A signed-in save is stamped with that person, whatever the app sent. Server jobs (service role) pass their own.
  if who is not null then
    new.created_by := who;
    select full_name into new.created_by_name from public.staff where id = who;
  end if;
  return new;
end;
$function$;
revoke execute on function public.number_agreement_version() from public;

create or replace function public.point_agreement_at_version()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  update public.agreements set current_version_id = new.id where id = new.agreement_id;
  return null;
end;
$function$;
revoke execute on function public.point_agreement_at_version() from public;

create or replace function public.guard_agreement_version()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  raise exception 'a saved agreement version cannot be changed; save a new version instead' using errcode = '42501';
end;
$function$;
revoke execute on function public.guard_agreement_version() from public;

CREATE TRIGGER agreement_versions_number BEFORE INSERT ON public.agreement_versions FOR EACH ROW EXECUTE FUNCTION number_agreement_version();
CREATE TRIGGER agreement_versions_point AFTER INSERT ON public.agreement_versions FOR EACH ROW EXECUTE FUNCTION point_agreement_at_version();
CREATE TRIGGER agreement_versions_guard BEFORE UPDATE ON public.agreement_versions FOR EACH ROW EXECUTE FUNCTION guard_agreement_version();

-- ── 3. The agreement's latest version ───────────────────────────────────────
alter table public.agreements add column if not exists current_version_id uuid;
alter table public.agreements add constraint agreements_current_version_fkey
  FOREIGN KEY (current_version_id) REFERENCES agreement_versions(id) ON DELETE SET NULL;

-- ── 4. Access ───────────────────────────────────────────────────────────────
alter table public.agreement_versions enable row level security;

create policy "staff read agreement versions" on public.agreement_versions as permissive for select to authenticated
  using (exists (select 1 from agreements a
                 where a.id = agreement_versions.agreement_id
                   and (is_owner()
                        or a.staff_id = auth.uid()
                        or exists (select 1 from quote_requests q where q.id = a.quote_id and q.assigned_to = auth.uid()))));

revoke all on public.agreement_versions from anon;
revoke update, delete, truncate on public.agreement_versions from authenticated;
revoke insert on public.agreement_versions from authenticated;
grant select on public.agreement_versions to authenticated;
grant all on public.agreement_versions to service_role;
