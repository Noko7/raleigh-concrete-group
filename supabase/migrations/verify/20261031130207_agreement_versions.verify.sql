-- Check 20261031130207_agreement_versions on the real database.
--
-- Run AFTER the migration, as the SQL editor's own role (postgres), the whole file at once. It opens its own
-- transaction and ends in ROLLBACK, so nothing it creates is kept. It makes a throwaway contractor agreement on a
-- real staff row (owner or contractor, whichever exists first); no customer details are read or printed.
-- Output: one row per check; any result containing "(bad)" is a failure.

begin;
create temp table _r (check_name text, result text);
grant all on _r to public;

do $$
declare ag uuid; st uuid; v1 public.agreement_versions; v2 public.agreement_versions; r text;
begin
  select id into st from public.staff order by created_at limit 1;
  insert into public.agreements (kind, staff_id, title) values ('contractor', st, 'Verify agreement') returning id into ag;

  insert into public.agreement_versions (agreement_id, version_no, template_version, body, html, html_sha256)
    values (ag, 99, 't', '{}'::jsonb, '<p>one</p>', repeat('0', 64)) returning * into v1;
  insert into _r values ('first save is version 1', case when v1.version_no = 1 then 'ok' else 'GOT ' || v1.version_no || ' (bad)' end);
  insert into _r values ('fingerprint computed by the database',
    case when v1.html_sha256 = encode(sha256(convert_to('<p>one</p>', 'UTF8')), 'hex') then 'ok' else 'WRONG HASH (bad)' end);

  insert into public.agreement_versions (agreement_id, version_no, template_version, body, html, html_sha256)
    values (ag, 1, 't', '{}'::jsonb, '<p>two</p>', repeat('0', 64)) returning * into v2;
  insert into _r values ('next save is version 2', case when v2.version_no = 2 then 'ok' else 'GOT ' || v2.version_no || ' (bad)' end);
  insert into _r values ('agreement points at the latest version',
    case when (select current_version_id from public.agreements where id = ag) = v2.id then 'ok' else 'NOT UPDATED (bad)' end);

  begin update public.agreement_versions set html = 'x' where id = v1.id; r := 'EDIT ALLOWED (bad)';
  exception when others then r := sqlerrm; end;
  insert into _r values ('a saved version cannot be edited', r);

  insert into _r values ('signed-in users can only read versions',
    case when has_table_privilege('authenticated', 'public.agreement_versions', 'INSERT')
           or has_table_privilege('authenticated', 'public.agreement_versions', 'UPDATE')
           or has_table_privilege('authenticated', 'public.agreement_versions', 'DELETE') then 'GRANTED (bad)' else 'ok' end);
  insert into _r values ('deleting a staff member never touches a saved version',
    case when exists (select 1 from pg_constraint where conrelid = 'public.agreement_versions'::regclass and contype = 'f'
                      and confrelid = 'public.staff'::regclass) then 'FOREIGN KEY TO STAFF (bad)' else 'ok' end);
  insert into _r values ('anon has no access',
    case when has_table_privilege('anon', 'public.agreement_versions', 'SELECT') then 'GRANTED (bad)' else 'ok' end);
  insert into _r values ('RLS on', case when (select relrowsecurity from pg_class where oid = 'public.agreement_versions'::regclass) then 'ok' else 'OFF (bad)' end);

  begin update public.staff set payment_methods = '{bitcoin}' where id = st; r := 'BAD METHOD ALLOWED (bad)';
  exception when check_violation then r := 'refused'; end;
  insert into _r values ('payment methods limited to the four', r);

  delete from public.agreements where id = ag;
  insert into _r values ('versions go with their agreement',
    case when exists (select 1 from public.agreement_versions where agreement_id = ag) then 'LEFT BEHIND (bad)' else 'ok' end);
end $$;

select * from _r;
rollback;
