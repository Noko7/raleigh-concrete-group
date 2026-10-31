-- Raleigh Concrete Group - agreement templates the owner creates, clones, archives and versions
-- Undo: undo/20261031172234_document_templates.undo.sql. Check: verify/20261031172234_document_templates.verify.sql.
-- Comes after 20261031130207_agreement_versions (same patterns; independent tables).
--
-- A template is the clause text an agreement is drafted from: the standard work agreement, the repair agreement,
-- or any variant the owner makes (a stamped-concrete job, a commercial job). Templates live in the Documents hub.
--
--   1. document_templates: one row per template. name, status (active or archived; archived ones can't start new
--      agreements but stay readable), cloned_from_id (the template it was copied from), current_version_id (set by
--      the database on each save), who made it. Templates are never deleted through the app.
--   2. document_template_versions: one row per save of a template, numbered 1, 2, 3... per template with no gaps
--      (assigned by the database under a lock on the template row), never changed afterwards (a trigger refuses
--      UPDATE for every role). body is the template's clauses and tax default, checked by the server
--      (parseTemplateBody) before it is written. created_by has no foreign key and created_by_name keeps the
--      saver's name, as on agreement_versions.
--   3. Access: signed-in staff read templates and their versions (the owner all of them, contractors the active
--      ones, so they can pick one). Nobody writes through the API: no INSERT/UPDATE/DELETE grants for anon or
--      authenticated. The server writes with the service role after checking the caller is the owner.
--   4. Two templates to start with, generated from src/lib/crm/template-seeds.ts by scripts/template-seed-sql.ts:
--      "Standard Work Agreement" (the Drive master) and "Repair Agreement" (the Drive repair agreement).
--
-- An agreement keeps a copy of the template version it was drafted from inside its own saved versions, so editing
-- or archiving a template never changes an agreement already written, sent or signed.

set local lock_timeout = '5s';

-- ── 1. Templates ────────────────────────────────────────────────────────────
create table public.document_templates (
  id uuid default gen_random_uuid() not null,
  name text not null,
  kind text default 'customer_agreement'::text not null,
  status text default 'active'::text not null,
  current_version_id uuid,
  cloned_from_id uuid,
  created_by uuid,
  created_by_name text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint document_templates_pkey PRIMARY KEY (id),
  constraint document_templates_cloned_from_fkey FOREIGN KEY (cloned_from_id) REFERENCES document_templates(id) ON DELETE SET NULL,
  constraint document_templates_chk CHECK (
    char_length(btrim(name)) between 1 and 120
    and kind = 'customer_agreement'
    and status in ('active', 'archived')
    and (created_by_name is null or char_length(created_by_name) <= 200)
  )
);
CREATE INDEX document_templates_status_idx ON public.document_templates USING btree (status, name);
CREATE TRIGGER document_templates_touch_updated_at BEFORE UPDATE ON public.document_templates FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ── 2. Versions ─────────────────────────────────────────────────────────────
create table public.document_template_versions (
  id uuid default gen_random_uuid() not null,
  template_id uuid not null,
  version_no integer not null,
  body jsonb not null,
  note text,
  created_by uuid,
  created_by_name text,
  created_at timestamp with time zone default now() not null,
  constraint document_template_versions_pkey PRIMARY KEY (id),
  constraint document_template_versions_template_fkey FOREIGN KEY (template_id) REFERENCES document_templates(id) ON DELETE CASCADE,
  constraint document_template_versions_no_key UNIQUE (template_id, version_no),
  constraint document_template_versions_chk CHECK (
    version_no >= 1
    and jsonb_typeof(body) = 'object'
    and jsonb_typeof(body->'clauses') = 'array'
    and pg_column_size(body) <= 300000
    and (note is null or char_length(note) <= 300)
    and (created_by_name is null or char_length(created_by_name) <= 200)
  )
);
CREATE INDEX document_template_versions_template_idx ON public.document_template_versions USING btree (template_id, version_no DESC);

alter table public.document_templates add constraint document_templates_current_version_fkey
  FOREIGN KEY (current_version_id) REFERENCES document_template_versions(id) ON DELETE SET NULL;

create or replace function public.number_template_version()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  perform 1 from public.document_templates where id = new.template_id for update;
  if not found then
    raise exception 'template % does not exist', new.template_id using errcode = '23503';
  end if;
  select coalesce(max(version_no), 0) + 1 into new.version_no from public.document_template_versions where template_id = new.template_id;
  new.created_at := now();
  return new;
end;
$function$;
revoke execute on function public.number_template_version() from public;

create or replace function public.point_template_at_version()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  update public.document_templates set current_version_id = new.id where id = new.template_id;
  return null;
end;
$function$;
revoke execute on function public.point_template_at_version() from public;

create or replace function public.guard_template_version()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  raise exception 'a saved template version cannot be changed; save a new version instead' using errcode = '42501';
end;
$function$;
revoke execute on function public.guard_template_version() from public;

CREATE TRIGGER document_template_versions_number BEFORE INSERT ON public.document_template_versions FOR EACH ROW EXECUTE FUNCTION number_template_version();
CREATE TRIGGER document_template_versions_point AFTER INSERT ON public.document_template_versions FOR EACH ROW EXECUTE FUNCTION point_template_at_version();
CREATE TRIGGER document_template_versions_guard BEFORE UPDATE ON public.document_template_versions FOR EACH ROW EXECUTE FUNCTION guard_template_version();

-- ── 3. Access ───────────────────────────────────────────────────────────────
alter table public.document_templates enable row level security;
alter table public.document_template_versions enable row level security;

create policy "staff read templates" on public.document_templates as permissive for select to authenticated
  using (is_owner() or (status = 'active' and exists (select 1 from staff s where s.id = auth.uid() and s.active)));

create policy "staff read template versions" on public.document_template_versions as permissive for select to authenticated
  using (exists (select 1 from document_templates t
                 where t.id = document_template_versions.template_id
                   and (is_owner() or (t.status = 'active' and exists (select 1 from staff s where s.id = auth.uid() and s.active)))));

revoke all on public.document_templates from anon;
revoke all on public.document_template_versions from anon;
revoke insert, update, delete, truncate on public.document_templates from authenticated;
revoke insert, update, delete, truncate on public.document_template_versions from authenticated;
grant select on public.document_templates to authenticated;
grant select on public.document_template_versions to authenticated;
grant all on public.document_templates to service_role;
grant all on public.document_template_versions to service_role;

-- ── 4. The two starting templates (generated: node scripts/template-seed-sql.ts) ──
with t as (
  insert into public.document_templates (name, created_by_name) values ('Standard Work Agreement', 'Seeded from Google Drive') returning id
)
insert into public.document_template_versions (template_id, version_no, body, note, created_by_name)
  select id, 1, $seed${"tax_mode":"plus_tax","clauses":[{"id":"clause.basics","kind":"clause","title":"Please Read — Concrete Basics","optional":false,"text":"- **Concrete cracks.** Hairline and shrinkage cracks, and cracking from ground movement, are normal and not a defect. Joints direct cracking but don't prevent it.\n- **Color, finish, and surface variation** (including efflorescence, the white haze) are normal.\n- **Stay off** new concrete for 24 hours; keep vehicles off for 7 days, heavy vehicles 28 days. Damage from early use is the customer's responsibility.\n- **We call 811** for public utilities. You must mark private lines (sprinklers, pet fence, lighting, private water/gas). Unmarked private lines aren't our responsibility.\n- **You confirm** that you own the property (or may authorize the work) and that it meets any HOA / setback rules.","text_includes_tax":null,"on_by_default":false},{"id":"clause.repair","kind":"initials","title":"Repair Limitations - Please Initial Each","optional":true,"text":"This is a repair to existing concrete, not a replacement. Please read and initial each item.\n\n- **Color and texture will not match.** Repair material comes from a different batch than the original concrete and will not match its color, shade, or texture exactly. Repaired areas will be visible and may weather differently over time. A color or texture difference is not a defect and is not a reason to withhold payment or to redo the work.\n- **Only the listed areas are repaired.** This job covers only the chips and cracks identified at the time of the estimate. The rest of the slab, adjacent concrete, and any areas not pointed out are not included or warranted.\n- **Existing conditions are not fixed.** The repair is cosmetic, not structural. It does not correct the causes of the damage, such as settlement, poor base, soil movement, tree roots, drainage, or freeze-thaw. Existing cracks may reopen or spread, and new cracks may form.\n- **No responsibility for future repairs.** Neither the Contractor nor Raleigh Concrete Group is responsible for any further repair, replacement, or resurfacing of this slab after this job, except as stated in the Warranty below.","text_includes_tax":null,"on_by_default":false},{"id":"clause.warranty","kind":"clause","title":"Warranty","optional":false,"text":"The Contractor warrants workmanship for one (1) year from completion. This does not cover the normal concrete characteristics above, ground movement, misuse, de-icing salt, or lack of maintenance. Repair or replacement of faulty workmanship is the only remedy. Warranty and any claims are handled by the Contractor.","text_includes_tax":null,"on_by_default":false},{"id":"clause.responsible","kind":"clause","title":"Who's Responsible","optional":false,"text":"The Contractor is the party you're hiring and is responsible for the work, warranty, permits, and any claims. Raleigh Concrete Group is not the contractor, does not perform or warrant the work, and does not receive or hold your payment.","text_includes_tax":null,"on_by_default":false},{"id":"clause.insurance","kind":"clause","title":"Insurance","optional":true,"text":"The Contractor carries general liability insurance and will provide a certificate of insurance on request.\n\nRaleigh Concrete Group books the job only. It does not perform the work and does not carry insurance for it.","text_includes_tax":null,"on_by_default":false},{"id":"clause.liability","kind":"clause","title":"Limitation of Liability","optional":true,"text":"The Contractor's total liability for any claim related to this work is limited to the amount paid under this agreement. Neither the Contractor nor Raleigh Concrete Group is liable for indirect or consequential damages, such as loss of use or damage resulting from existing conditions. This does not limit liability for bodily injury or property damage caused by the Contractor's negligence, which is covered by the Contractor's insurance.","text_includes_tax":null,"on_by_default":false},{"id":"clause.cancel","kind":"clause","title":"Your Right to Cancel","optional":false,"text":"If you signed this at your home, you may cancel within 3 business days by written notice to Raleigh Concrete Group at the contact above. Any deposit is refunded within 10 days.","text_includes_tax":null,"on_by_default":false},{"id":"clause.authorization","kind":"clause","title":"Authorization","optional":false,"text":"I authorize the Contractor to perform the work described above at the price shown. I have read the concrete basics, warranty, and cancellation terms.","text_includes_tax":"I authorize the Contractor to perform the work described above for the total price shown, which includes all taxes and fees. I have read and understand the terms above.","on_by_default":false}]}$seed$::jsonb, 'Seeded from the Drive master (CUSTOMER AGREEMENT AND WORK AUTH TEMPLATE)', 'Seeded from Google Drive' from t;

with t as (
  insert into public.document_templates (name, created_by_name) values ('Repair Agreement', 'Seeded from Google Drive') returning id
)
insert into public.document_template_versions (template_id, version_no, body, note, created_by_name)
  select id, 1, $seed${"tax_mode":"includes_tax","clauses":[{"id":"clause.basics","kind":"clause","title":"Please Read — Concrete Basics","optional":false,"text":"- **Concrete cracks.** Hairline and shrinkage cracks, and cracking from ground movement, are normal and not a defect. Joints direct cracking but don't prevent it.\n- **Color, finish, and surface variation** (including efflorescence, the white haze) are normal.\n- **Stay off** new concrete for 24 hours; keep vehicles off for 7 days, heavy vehicles 28 days. Damage from early use is the customer's responsibility.\n- **We call 811** for public utilities. You must mark private lines (sprinklers, pet fence, lighting, private water/gas). Unmarked private lines aren't our responsibility.\n- **You confirm** that you own the property (or may authorize the work) and that it meets any HOA / setback rules.","text_includes_tax":null,"on_by_default":false},{"id":"clause.repair","kind":"initials","title":"Repair Limitations - Please Initial Each","optional":false,"text":"This is a repair to existing concrete, not a replacement. Please read and initial each item.\n\n- **Color and texture will not match.** Repair material comes from a different batch than the original concrete and will not match its color, shade, or texture exactly. Repaired areas will be visible and may weather differently over time. A color or texture difference is not a defect and is not a reason to withhold payment or to redo the work.\n- **Only the listed areas are repaired.** This job covers only the chips and cracks identified at the time of the estimate. The rest of the slab, adjacent concrete, and any areas not pointed out are not included or warranted.\n- **Existing conditions are not fixed.** The repair is cosmetic, not structural. It does not correct the causes of the damage, such as settlement, poor base, soil movement, tree roots, drainage, or freeze-thaw. Existing cracks may reopen or spread, and new cracks may form.\n- **No responsibility for future repairs.** Neither the Contractor nor Raleigh Concrete Group is responsible for any further repair, replacement, or resurfacing of this slab after this job, except as stated in the Warranty below.","text_includes_tax":null,"on_by_default":false},{"id":"clause.responsible","kind":"clause","title":"Who's Responsible","optional":false,"text":"The Contractor is the party you're hiring and is responsible for the work, warranty, permits, and any claims. Raleigh Concrete Group is not the contractor, does not perform or warrant the work, and does not receive or hold your payment.","text_includes_tax":null,"on_by_default":false},{"id":"clause.insurance","kind":"clause","title":"Insurance","optional":false,"text":"The Contractor carries general liability insurance and will provide a certificate of insurance on request.\n\nRaleigh Concrete Group books the job only. It does not perform the work and does not carry insurance for it.","text_includes_tax":null,"on_by_default":false},{"id":"clause.liability","kind":"clause","title":"Limitation of Liability","optional":false,"text":"The Contractor's total liability for any claim related to this work is limited to the amount paid under this agreement. Neither the Contractor nor Raleigh Concrete Group is liable for indirect or consequential damages, such as loss of use or damage resulting from existing conditions. This does not limit liability for bodily injury or property damage caused by the Contractor's negligence, which is covered by the Contractor's insurance.","text_includes_tax":null,"on_by_default":false},{"id":"clause.cancel","kind":"clause","title":"Your Right to Cancel","optional":false,"text":"If you signed this at your home, you may cancel within 3 business days by written notice to Raleigh Concrete Group or the Contractor at the contact above. Any deposit is refunded within 10 days.","text_includes_tax":null,"on_by_default":false},{"id":"clause.authorization","kind":"clause","title":"Authorization","text":"I authorize the Contractor to perform the work described above at the price shown. I have read and understand the concrete basics, repair limitations, warranty, insurance, limitation of liability, and cancellation terms.","text_includes_tax":"I authorize the Contractor to perform the work described above for the total price shown, which includes all taxes and fees. I have read and understand the concrete basics, repair limitations, warranty, insurance, limitation of liability, and cancellation terms.","optional":false,"on_by_default":false}]}$seed$::jsonb, 'Seeded from the Drive repair agreement (Alexavier, 95 Parkland Dr), made generic', 'Seeded from Google Drive' from t;
