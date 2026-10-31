-- Check 20261031172234_document_templates on the real database.
--
-- Run AFTER the migration, as the SQL editor's own role (postgres), the whole file at once. It opens its own
-- transaction and ends in ROLLBACK, so nothing it creates is kept. No customer details are read or printed.
-- Output: one row per check; any result containing "(bad)" is a failure.

begin;
create temp table _r (check_name text, result text);
grant all on _r to public;

do $$
declare t uuid; v1 public.document_template_versions; v2 public.document_template_versions; r text; n int;
begin
  select count(*) into n from public.document_templates t2
   where t2.name in ('Standard Work Agreement', 'Repair Agreement') and t2.status = 'active' and t2.current_version_id is not null;
  insert into _r values ('both starting templates seeded, version 1', case when n = 2 then 'ok' else 'GOT ' || n || ' (bad)' end);
  insert into _r values ('repair template has no warranty section',
    case when exists (select 1 from public.document_templates d join public.document_template_versions v on v.id = d.current_version_id
                      where d.name = 'Repair Agreement' and v.body::text like '%"clause.warranty"%') then 'HAS WARRANTY (bad)' else 'ok' end);

  insert into public.document_templates (name) values ('Verify template') returning id into t;
  insert into public.document_template_versions (template_id, version_no, body) values (t, 99, '{"tax_mode":"plus_tax","clauses":[]}') returning * into v1;
  insert into public.document_template_versions (template_id, version_no, body) values (t, 99, '{"tax_mode":"plus_tax","clauses":[]}') returning * into v2;
  insert into _r values ('versions numbered 1, 2 by the database', case when v1.version_no = 1 and v2.version_no = 2 then 'ok' else 'GOT ' || v1.version_no || ',' || v2.version_no || ' (bad)' end);
  insert into _r values ('template points at its latest version',
    case when (select current_version_id from public.document_templates where id = t) = v2.id then 'ok' else 'NOT UPDATED (bad)' end);

  begin update public.document_template_versions set note = 'x' where id = v1.id; r := 'EDIT ALLOWED (bad)';
  exception when others then r := sqlerrm; end;
  insert into _r values ('a saved template version cannot be edited', r);

  begin update public.document_templates set status = 'deleted' where id = t; r := 'BAD STATUS ALLOWED (bad)';
  exception when check_violation then r := 'refused'; end;
  insert into _r values ('status is active or archived', r);

  insert into _r values ('signed-in users can only read',
    case when has_table_privilege('authenticated', 'public.document_templates', 'INSERT')
           or has_table_privilege('authenticated', 'public.document_templates', 'UPDATE')
           or has_table_privilege('authenticated', 'public.document_template_versions', 'INSERT')
           or has_table_privilege('authenticated', 'public.document_template_versions', 'UPDATE')
           or has_table_privilege('anon', 'public.document_templates', 'SELECT') then 'GRANTED (bad)' else 'ok' end);
  insert into _r values ('RLS on both tables',
    case when (select bool_and(relrowsecurity) from pg_class where oid in ('public.document_templates'::regclass, 'public.document_template_versions'::regclass))
         then 'ok' else 'OFF (bad)' end);
end $$;

select * from _r;
rollback;
