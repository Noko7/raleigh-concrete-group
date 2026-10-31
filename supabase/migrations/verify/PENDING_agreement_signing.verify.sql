-- Check PENDING_agreement_signing on the real database.
--
-- Run AFTER the migration, as the SQL editor's own role (postgres), the whole file at once. It opens its own
-- transaction and ends in ROLLBACK, so nothing it creates is kept. No customer details are read or printed.
-- Output: one row per check; any result containing "(bad)" is a failure.

begin;
create temp table _r (check_name text, result text);
grant all on _r to public;

do $$
declare ag uuid; ag2 uuid; st uuid; v1 uuid; other uuid; r text;
begin
  select id into st from public.staff order by created_at limit 1;
  insert into public.agreements (kind, staff_id, title) values ('contractor', st, 'Verify signing') returning id into ag;
  insert into public.agreements (kind, staff_id, title) values ('contractor', st, 'Verify other') returning id into ag2;
  insert into public.agreement_versions (agreement_id, version_no, template_version, body, html, html_sha256)
    values (ag, 1, 't', '{}'::jsonb, '<p>v1</p>', repeat('0', 64)) returning id into v1;
  insert into public.agreement_versions (agreement_id, version_no, template_version, body, html, html_sha256)
    values (ag2, 1, 't', '{}'::jsonb, '<p>x</p>', repeat('0', 64)) returning id into other;

  begin update public.agreements set sent_version_id = other where id = ag; r := 'ANOTHER AGREEMENT''S VERSION ACCEPTED (bad)';
  exception when foreign_key_violation then r := 'refused'; end;
  insert into _r values ('the version sent belongs to this agreement', r);

  update public.agreements set status = 'sent', sent_version_id = v1, docuseal_submission_id = 987654321 where id = ag;
  insert into public.agreement_signing (agreement_id, submission_id, sign_token, signers)
    values (ag, 987654321, replace(gen_random_uuid()::text, '-', ''), '[]'::jsonb);
  begin
    insert into public.agreement_versions (agreement_id, version_no, template_version, body, html, html_sha256)
      values (ag, 1, 't', '{}'::jsonb, '<p>v2</p>', repeat('0', 64));
    r := 'SAVED WHILE OUT FOR SIGNATURE (bad)';
  exception when others then r := sqlerrm; end;
  insert into _r values ('no new version while out for signature', r);

  update public.agreements set status = 'contractor_signed' where id = ag;
  update public.agreements set status = 'declined' where id = ag;
  insert into public.agreement_versions (agreement_id, version_no, template_version, body, html, html_sha256)
    values (ag, 1, 't', '{}'::jsonb, '<p>v2</p>', repeat('0', 64));
  insert into _r values ('editable again after a decline', 'ok');

  begin insert into public.agreement_signing (agreement_id, submission_id, sign_token, signers) values (ag2, 1, 'nope', '[]'::jsonb); r := 'BAD TOKEN ALLOWED (bad)';
  exception when check_violation then r := 'refused'; end;
  insert into _r values ('sign token must be 32 hex', r);

  insert into public.document_events (agreement_id, submission_id, event_type, signer_role, event_at, payload)
    values (ag, 987654321, 'form.completed', 'Contractor', '2026-10-31T12:00:00Z', '{}'::jsonb);
  insert into public.document_events (agreement_id, submission_id, event_type, signer_role, event_at, payload)
    values (ag, 987654321, 'form.completed', 'Customer', '2026-10-31T12:00:00Z', '{}'::jsonb);
  begin
    insert into public.document_events (agreement_id, submission_id, event_type, signer_role, event_at, payload)
      values (ag, 987654321, 'form.completed', 'Contractor', '2026-10-31T12:00:00Z', '{}'::jsonb);
    r := 'DUPLICATE EVENT STORED (bad)';
  exception when unique_violation then r := 'refused'; end;
  insert into _r values ('one row per event and signer', r);

  insert into _r values ('signing links and events are server-only',
    case when has_table_privilege('authenticated', 'public.agreement_signing', 'SELECT')
           or has_table_privilege('anon', 'public.agreement_signing', 'SELECT')
           or has_table_privilege('authenticated', 'public.document_events', 'SELECT') then 'GRANTED (bad)' else 'ok' end);
end $$;

select * from _r;
rollback;
