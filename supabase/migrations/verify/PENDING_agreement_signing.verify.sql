-- Check PENDING_agreement_signing on the real database.
--
-- Run AFTER the migration, as the SQL editor's own role (postgres), the whole file at once. It opens its own
-- transaction and ends in ROLLBACK, so nothing it creates is kept. No customer details are read or printed.
-- Output: one row per check; any result containing "(bad)" is a failure.

begin;
create temp table _r (check_name text, result text);
grant all on _r to public;

do $$
declare ag uuid; st uuid; v1 uuid; r text;
begin
  select id into st from public.staff order by created_at limit 1;
  insert into public.agreements (kind, staff_id, title) values ('contractor', st, 'Verify signing') returning id into ag;
  insert into public.agreement_versions (agreement_id, version_no, template_version, body, html, html_sha256)
    values (ag, 1, 't', '{}'::jsonb, '<p>v1</p>', repeat('0', 64)) returning id into v1;

  update public.agreements set status = 'sent', sent_version_id = v1, docuseal_submission_id = 987654321,
    sign_token = replace(gen_random_uuid()::text, '-', ''), signers = '[]'::jsonb where id = ag;
  begin
    insert into public.agreement_versions (agreement_id, version_no, template_version, body, html, html_sha256)
      values (ag, 1, 't', '{}'::jsonb, '<p>v2</p>', repeat('0', 64));
    r := 'SAVED WHILE OUT FOR SIGNATURE (bad)';
  exception when others then r := sqlerrm; end;
  insert into _r values ('no new version while out for signature', r);

  update public.agreements set status = 'contractor_signed' where id = ag;
  insert into _r values ('contractor_signed is a status', 'ok');

  update public.agreements set status = 'declined' where id = ag;
  insert into public.agreement_versions (agreement_id, version_no, template_version, body, html, html_sha256)
    values (ag, 1, 't', '{}'::jsonb, '<p>v2</p>', repeat('0', 64));
  insert into _r values ('editable again after a decline', 'ok');

  begin update public.agreements set sign_token = 'nope' where id = ag; r := 'BAD TOKEN ALLOWED (bad)';
  exception when check_violation then r := 'refused'; end;
  insert into _r values ('sign token must be 32 hex', r);

  insert into public.document_events (agreement_id, submission_id, event_type, event_at, payload)
    values (ag, 987654321, 'form.completed', '2026-10-31T12:00:00Z', '{}'::jsonb);
  begin
    insert into public.document_events (agreement_id, submission_id, event_type, event_at, payload)
      values (ag, 987654321, 'form.completed', '2026-10-31T12:00:00Z', '{}'::jsonb);
    r := 'DUPLICATE EVENT STORED (bad)';
  exception when unique_violation then r := 'refused'; end;
  insert into _r values ('a retried webhook is stored once', r);

  insert into _r values ('no API access to document_events',
    case when has_table_privilege('authenticated', 'public.document_events', 'SELECT')
           or has_table_privilege('anon', 'public.document_events', 'SELECT') then 'GRANTED (bad)' else 'ok' end);
end $$;

select * from _r;
rollback;
