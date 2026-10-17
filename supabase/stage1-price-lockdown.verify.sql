-- Raleigh Concrete Group - check stage 1 (price lockdown) on the real database
--
-- Run AFTER stage1-price-lockdown.sql, as the SQL editor's own role (postgres),
-- the whole file at once. It opens its own transaction and ends in ROLLBACK, and
-- every individual write inside is also undone on the spot (each one runs in
-- its own sub-transaction that is deliberately aborted), so nothing it does is
-- ever kept - not even if it stops half way.
--
-- What it does: picks real jobs by query (ids only - no customer details are
-- read or printed), then pretends to be
--   * the contractor assigned to an approved job,
--   * the contractor on a quote nobody has answered yet,
--   * the contractor on a job already marked Paid,
--   * the owner, and
--   * the server (service role),
-- by setting the same JWT claims PostgREST would, and tries the writes each of
-- them can or cannot make. Each line of output is PASS, FAIL or SKIP; the last
-- statement raises an error if anything FAILed, and says ALL PASSED otherwise.
--
-- A SKIP means there was nothing to test on (no job in that state, or a job
-- with no line items). It is not a failure, but it is not proof either.

begin;

-- ── Fixtures (ids only) ─────────────────────────────────────────────────────
-- Practice leads first when there are any, then the most recently touched.

-- An approved job, assigned to an active contractor, with a price and no
-- change waiting on the customer.
select set_config('stage1.job', coalesce((
  select q.id::text
    from public.quote_requests q
    join public.staff s on s.id = q.assigned_to and s.role = 'contractor' and s.active
   where q.customer_response = 'accepted'
     and q.status in ('approved', 'scheduled', 'completed')
     and q.archived_at is null
     and q.change_requested_at is null
     and q.quote_amount > 1
   order by q.is_test desc, q.updated_at desc
   limit 1), ''), true);
select set_config('stage1.crew', coalesce((
  select q.assigned_to::text from public.quote_requests q
   where q.id::text = current_setting('stage1.job')), ''), true);

-- A quote the customer has not answered, assigned to an active contractor.
select set_config('stage1.open_job', coalesce((
  select q.id::text
    from public.quote_requests q
    join public.staff s on s.id = q.assigned_to and s.role = 'contractor' and s.active
   where q.customer_response is null
     and q.status in ('new', 'quoted')
     and q.archived_at is null
   order by q.is_test desc, q.updated_at desc
   limit 1), ''), true);
select set_config('stage1.open_crew', coalesce((
  select q.assigned_to::text from public.quote_requests q
   where q.id::text = current_setting('stage1.open_job')), ''), true);

-- A job already marked Paid, assigned to an active contractor.
select set_config('stage1.paid_job', coalesce((
  select q.id::text
    from public.quote_requests q
    join public.staff s on s.id = q.assigned_to and s.role = 'contractor' and s.active
   where q.status = 'paid'
     and q.archived_at is null
   order by q.is_test desc, q.updated_at desc
   limit 1), ''), true);
select set_config('stage1.paid_crew', coalesce((
  select q.assigned_to::text from public.quote_requests q
   where q.id::text = current_setting('stage1.paid_job')), ''), true);

-- An active owner.
select set_config('stage1.owner', coalesce((
  select s.id::text from public.staff s
   where s.role = 'owner' and s.active
   order by s.created_at
   limit 1), ''), true);

select set_config('stage1.failures', '0', true);

select current_setting('stage1.job')      as approved_job,
       current_setting('stage1.open_job') as open_job,
       current_setting('stage1.paid_job') as paid_job,
       current_setting('stage1.owner') <> '' as owner_found;

-- The guard is installed: three triggers, two functions.
select c.relname as table_name, t.tgname, p.proname
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_proc p on p.oid = t.tgfoid
 where not t.tgisinternal
   and t.tgname in ('qr_guard_money_columns', 'qo_guard_line_prices', 'qp_guard_line_prices')
 order by 1;

-- ════════════════════════════════════════════════════════════════════════════
-- A. The contractor on an APPROVED job
-- ════════════════════════════════════════════════════════════════════════════
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('stage1.crew'), 'role', 'authenticated')::text, true);
set local role authenticated;

do $$
declare
  job uuid := nullif(current_setting('stage1.job'), '')::uuid;
  t record;
  n bigint;
  bad int := 0;
begin
  if job is null then
    raise notice 'SKIP  A: no approved job assigned to an active contractor';
    return;
  end if;

  -- expect: 'allow' or 'block'. empty_ok: zero rows matched is a SKIP (line
  -- items the job may not have) rather than a failure.
  for t in
    select * from (values
      -- Refused: the price and the answer that locks it.
      ('price down',                         'update public.quote_requests set quote_amount = quote_amount - 1 where id = $1', 'block', false),
      ('price up',                           'update public.quote_requests set quote_amount = quote_amount + 1 where id = $1', 'block', false),
      ('decline credit',                     'update public.quote_requests set discount_accepted = not discount_accepted where id = $1', 'block', false),
      ('clear the answer',                   'update public.quote_requests set customer_response = null where id = $1', 'block', false),
      ('flip the answer to declined',        'update public.quote_requests set customer_response = ''declined'' where id = $1', 'block', false),
      ('restamp the answer',                 'update public.quote_requests set customer_responded_at = now() where id = $1', 'block', false),
      ('clear the answer and reprice at once', 'update public.quote_requests set customer_response = null, quote_amount = 1 where id = $1', 'block', false),
      -- Refused: money and decisions that belong to the office or the ledger.
      ('mark paid',                          'update public.quote_requests set status = ''paid'' where id = $1', 'block', false),
      ('stamp paid_at',                      'update public.quote_requests set paid_at = now() where id = $1', 'block', false),
      ('deposit target',                     'update public.quote_requests set deposit_target_cents = coalesce(deposit_target_cents, 0) + 100 where id = $1', 'block', false),
      ('fee rate',                           'update public.quote_requests set fee_rate = 0 where id = $1', 'block', false),
      ('fee total',                          'update public.quote_requests set fee_total_cents = 0 where id = $1', 'block', false),
      ('fee waiver',                         'update public.quote_requests set fee_waived_cents = fee_waived_cents + 1 where id = $1', 'block', false),
      ('practice flag',                      'update public.quote_requests set is_test = not is_test where id = $1', 'block', false),
      ('archive',                            'update public.quote_requests set archived_at = now() where id = $1', 'block', false),
      -- Refused: the priced lines behind the approved price.
      ('add a line item',                    'insert into public.quote_options (quote_id, title, amount) values ($1, ''stage1 verify'', 1)', 'block', false),
      ('add an option',                      'insert into public.quote_packages (quote_id, title, amount) values ($1, ''stage1 verify'', 1)', 'block', false),
      ('reprice a line item',                'update public.quote_options set amount = amount + 1 where quote_id = $1', 'block', true),
      ('remove a line item',                 'delete from public.quote_options where quote_id = $1', 'block', true),
      ('reprice an option',                  'update public.quote_packages set amount = amount + 1 where quote_id = $1', 'block', true),

      -- Allowed: everything the crew do on an approved job today.
      ('private notes',                      'update public.quote_requests set internal_notes = coalesce(internal_notes, '''') || '' '' where id = $1', 'allow', false),
      ('same price written back',            'update public.quote_requests set quote_amount = quote_amount where id = $1', 'allow', false),
      ('book the day (confirmSchedule)',     'update public.quote_requests set status = case when status in (''completed'', ''paid'') then status else ''scheduled'' end, scheduled_by = auth.uid(), scheduled_at = now(), confirmed_at = null, reminder_sent_at = null where id = $1', 'allow', false),
      ('release the day (clearAppointment)', 'update public.quote_requests set scheduled_date = null, scheduled_time = null, scheduled_by = null, scheduled_at = null, confirmed_at = null, reminder_sent_at = null, status = case when status = ''scheduled'' then ''approved'' else status end where id = $1', 'allow', false),
      ('mark it done (completeJob)',         'update public.quote_requests set status = ''completed'', completed_at = now() where id = $1', 'allow', false),
      ('visit reminders (confirmVisit)',     'update public.quote_requests set visit_reminder_sent_at = null, visit_crew_reminded_at = null where id = $1', 'allow', false),
      ('photos (addJobPhotos)',              'update public.quote_requests set before_urls = before_urls, after_urls = after_urls where id = $1', 'allow', false),
      ('rotate links (rotateTokens)',        'update public.quote_requests set public_token = replace(gen_random_uuid()::text, ''-'', ''''), job_token = replace(gen_random_uuid()::text, ''-'', '''') where id = $1', 'allow', false),
      ('ask for payment (sendPayLink)',      'update public.quote_requests set payment_requested_at = now() where id = $1', 'allow', false),
      ('send a change order (requestChange)', 'update public.quote_requests set change_note = ''stage1 verify'', change_amount = quote_amount + 100, change_requested_at = now(), change_requested_by = auth.uid() where id = $1', 'allow', false),
      ('stamp line answers (phone approval)', 'update public.quote_options set customer_response = customer_response, responded_at = responded_at where quote_id = $1', 'allow', true),
      ('relabel a line item',                'update public.quote_options set title = title, description = description where quote_id = $1', 'allow', true)
    ) as v(label, stmt, expect, empty_ok)
  loop
    begin
      execute t.stmt using job;
      get diagnostics n = row_count;
      if n = 0 and t.empty_ok then
        raise notice 'SKIP  A: % (no rows to try it on)', t.label;
      elsif n = 0 then
        bad := bad + 1;
        raise notice 'FAIL  A: % matched no rows - the job is not visible to its contractor', t.label;
      elsif t.expect = 'allow' then
        raise notice 'PASS  A: % allowed', t.label;
      else
        bad := bad + 1;
        raise notice 'FAIL  A: % was ALLOWED', t.label;
      end if;
      raise exception 'stage1_undo_one';
    exception
      when insufficient_privilege then
        if t.expect = 'block' and sqlerrm not like 'new row violates row-level security%' then
          raise notice 'PASS  A: % refused (%)', t.label, sqlerrm;
        else
          bad := bad + 1;
          raise notice 'FAIL  A: % refused (%)', t.label, sqlerrm;
        end if;
      when others then
        if sqlerrm <> 'stage1_undo_one' then
          bad := bad + 1;
          raise notice 'FAIL  A: % raised % (%)', t.label, sqlstate, sqlerrm;
        end if;
    end;
  end loop;

  -- A change already in front of the customer: open one (allowed), rewrite it
  -- in place (refused), withdraw it (allowed). One sub-transaction, undone.
  begin
    update public.quote_requests
       set change_note = 'stage1 verify', change_amount = quote_amount + 100,
           change_requested_at = now(), change_requested_by = auth.uid()
     where id = job;
    begin
      update public.quote_requests set change_amount = change_amount - 50 where id = job;
      bad := bad + 1;
      raise notice 'FAIL  A: rewriting a pending change was ALLOWED';
    exception when insufficient_privilege then
      raise notice 'PASS  A: rewriting a pending change refused (%)', sqlerrm;
    end;
    begin
      update public.quote_requests set change_lines = '[]'::jsonb where id = job;
      bad := bad + 1;
      raise notice 'FAIL  A: adding lines to a pending change was ALLOWED';
    exception when insufficient_privilege then
      raise notice 'PASS  A: adding lines to a pending change refused (%)', sqlerrm;
    end;
    update public.quote_requests
       set change_note = null, change_amount = null, change_requested_at = null,
           change_requested_by = null, change_lines = null, change_deposit_cents = null
     where id = job;
    get diagnostics n = row_count;
    if n = 1 then
      raise notice 'PASS  A: withdrawing a pending change allowed';
    else
      bad := bad + 1;
      raise notice 'FAIL  A: withdrawing a pending change matched no rows';
    end if;
    raise exception 'stage1_undo_one';
  exception when others then
    if sqlerrm <> 'stage1_undo_one' then
      bad := bad + 1;
      raise notice 'FAIL  A: change order sequence raised % (%)', sqlstate, sqlerrm;
    end if;
  end;

  perform set_config('stage1.failures', (current_setting('stage1.failures')::int + bad)::text, true);
end;
$$;

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- B. The contractor on a quote NOBODY HAS ANSWERED - edits as before
-- ════════════════════════════════════════════════════════════════════════════
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('stage1.open_crew'), 'role', 'authenticated')::text, true);
set local role authenticated;

do $$
declare
  job uuid := nullif(current_setting('stage1.open_job'), '')::uuid;
  t record;
  n bigint;
  bad int := 0;
begin
  if job is null then
    raise notice 'SKIP  B: no unanswered quote assigned to an active contractor';
    return;
  end if;

  for t in
    select * from (values
      ('reprice the quote',                  'update public.quote_requests set quote_amount = coalesce(quote_amount, 0) + 1 where id = $1', 'allow', false),
      ('clear the price',                    'update public.quote_requests set quote_amount = null where id = $1', 'allow', false),
      ('send it (status quoted)',            'update public.quote_requests set status = ''quoted'', quote_sent_at = now(), quote_expires_at = now() + interval ''10 days'', quote_followup_sent_at = null where id = $1', 'allow', false),
      ('phone approval (recordOfflineAcceptance)', 'update public.quote_requests set customer_response = ''accepted'', customer_responded_at = now(), status = ''approved'', quote_amount = coalesce(quote_amount, 0) + 1 where id = $1', 'allow', false),
      ('add a line item',                    'insert into public.quote_options (quote_id, title, amount) values ($1, ''stage1 verify'', 1)', 'allow', false),
      ('add an option',                      'insert into public.quote_packages (quote_id, title, amount) values ($1, ''stage1 verify'', 1)', 'allow', false),
      ('reprice a line item',                'update public.quote_options set amount = amount + 1 where quote_id = $1', 'allow', true),
      ('mark paid',                          'update public.quote_requests set status = ''paid'' where id = $1', 'block', false),
      ('stamp paid_at',                      'update public.quote_requests set paid_at = now() where id = $1', 'block', false),
      ('deposit target',                     'update public.quote_requests set deposit_target_cents = 100 where id = $1', 'block', false),
      ('fee rate',                           'update public.quote_requests set fee_rate = 0 where id = $1', 'block', false)
    ) as v(label, stmt, expect, empty_ok)
  loop
    begin
      execute t.stmt using job;
      get diagnostics n = row_count;
      if n = 0 and t.empty_ok then
        raise notice 'SKIP  B: % (no rows to try it on)', t.label;
      elsif n = 0 then
        bad := bad + 1;
        raise notice 'FAIL  B: % matched no rows - the job is not visible to its contractor', t.label;
      elsif t.expect = 'allow' then
        raise notice 'PASS  B: % allowed', t.label;
      else
        bad := bad + 1;
        raise notice 'FAIL  B: % was ALLOWED', t.label;
      end if;
      raise exception 'stage1_undo_one';
    exception
      when insufficient_privilege then
        if t.expect = 'block' and sqlerrm not like 'new row violates row-level security%' then
          raise notice 'PASS  B: % refused (%)', t.label, sqlerrm;
        else
          bad := bad + 1;
          raise notice 'FAIL  B: % refused (%)', t.label, sqlerrm;
        end if;
      when others then
        if sqlerrm <> 'stage1_undo_one' then
          bad := bad + 1;
          raise notice 'FAIL  B: % raised % (%)', t.label, sqlstate, sqlerrm;
        end if;
    end;
  end loop;

  perform set_config('stage1.failures', (current_setting('stage1.failures')::int + bad)::text, true);
end;
$$;

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- C. The contractor on a job already marked PAID
-- ════════════════════════════════════════════════════════════════════════════
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('stage1.paid_crew'), 'role', 'authenticated')::text, true);
set local role authenticated;

do $$
declare
  job uuid := nullif(current_setting('stage1.paid_job'), '')::uuid;
  t record;
  n bigint;
  bad int := 0;
begin
  if job is null then
    raise notice 'SKIP  C: no paid job assigned to an active contractor';
    return;
  end if;

  for t in
    select * from (values
      ('move it off paid',                   'update public.quote_requests set status = ''completed'' where id = $1', 'block', false),
      ('clear paid_at',                      'update public.quote_requests set paid_at = null where id = $1', 'block', false),
      ('private notes',                      'update public.quote_requests set internal_notes = coalesce(internal_notes, '''') || '' '' where id = $1', 'allow', false)
    ) as v(label, stmt, expect, empty_ok)
  loop
    begin
      execute t.stmt using job;
      get diagnostics n = row_count;
      if n = 0 then
        bad := bad + 1;
        raise notice 'FAIL  C: % matched no rows - the job is not visible to its contractor', t.label;
      elsif t.expect = 'allow' then
        raise notice 'PASS  C: % allowed', t.label;
      else
        bad := bad + 1;
        raise notice 'FAIL  C: % was ALLOWED', t.label;
      end if;
      raise exception 'stage1_undo_one';
    exception
      when insufficient_privilege then
        if t.expect = 'block' and sqlerrm not like 'new row violates row-level security%' then
          raise notice 'PASS  C: % refused (%)', t.label, sqlerrm;
        else
          bad := bad + 1;
          raise notice 'FAIL  C: % refused (%)', t.label, sqlerrm;
        end if;
      when others then
        if sqlerrm <> 'stage1_undo_one' then
          bad := bad + 1;
          raise notice 'FAIL  C: % raised % (%)', t.label, sqlstate, sqlerrm;
        end if;
    end;
  end loop;

  perform set_config('stage1.failures', (current_setting('stage1.failures')::int + bad)::text, true);
end;
$$;

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- D. The OWNER on the approved job - full override
-- ════════════════════════════════════════════════════════════════════════════
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('stage1.owner'), 'role', 'authenticated')::text, true);
set local role authenticated;

do $$
declare
  job uuid := nullif(current_setting('stage1.job'), '')::uuid;
  t record;
  n bigint;
  bad int := 0;
begin
  if job is null or current_setting('stage1.owner') = '' then
    raise notice 'SKIP  D: no approved job, or no active owner';
    return;
  end if;

  for t in
    select * from (values
      ('price down',                         'update public.quote_requests set quote_amount = quote_amount - 1 where id = $1', false),
      ('clear the answer',                   'update public.quote_requests set customer_response = null, customer_responded_at = null where id = $1', false),
      ('mark paid',                          'update public.quote_requests set status = ''paid'', paid_at = now() where id = $1', false),
      ('deposit target',                     'update public.quote_requests set deposit_target_cents = coalesce(deposit_target_cents, 0) + 100 where id = $1', false),
      ('fee rate',                           'update public.quote_requests set fee_rate = 0 where id = $1', false),
      ('add a line item',                    'insert into public.quote_options (quote_id, title, amount) values ($1, ''stage1 verify'', 1)', false),
      ('reprice a line item',                'update public.quote_options set amount = amount + 1 where quote_id = $1', true)
    ) as v(label, stmt, empty_ok)
  loop
    begin
      execute t.stmt using job;
      get diagnostics n = row_count;
      if n = 0 and t.empty_ok then
        raise notice 'SKIP  D: % (no rows to try it on)', t.label;
      elsif n = 0 then
        bad := bad + 1;
        raise notice 'FAIL  D: % matched no rows', t.label;
      else
        raise notice 'PASS  D: owner % allowed', t.label;
      end if;
      raise exception 'stage1_undo_one';
    exception when others then
      if sqlerrm <> 'stage1_undo_one' then
        bad := bad + 1;
        raise notice 'FAIL  D: owner % raised % (%)', t.label, sqlstate, sqlerrm;
      end if;
    end;
  end loop;

  -- An owner rewriting a pending change in place stays allowed too.
  begin
    update public.quote_requests
       set change_note = 'stage1 verify', change_amount = quote_amount + 100,
           change_requested_at = now(), change_requested_by = auth.uid()
     where id = job;
    update public.quote_requests set change_amount = change_amount - 50 where id = job;
    raise notice 'PASS  D: owner rewriting a pending change allowed';
    raise exception 'stage1_undo_one';
  exception when others then
    if sqlerrm <> 'stage1_undo_one' then
      bad := bad + 1;
      raise notice 'FAIL  D: owner change order sequence raised % (%)', sqlstate, sqlerrm;
    end if;
  end;

  perform set_config('stage1.failures', (current_setting('stage1.failures')::int + bad)::text, true);
end;
$$;

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- E. The SERVER (service role) - webhooks, customer links, cron
-- ════════════════════════════════════════════════════════════════════════════
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
set local role service_role;

do $$
declare
  job uuid := nullif(current_setting('stage1.job'), '')::uuid;
  t record;
  n bigint;
  bad int := 0;
begin
  if job is null then
    raise notice 'SKIP  E: no approved job';
    return;
  end if;

  for t in
    select * from (values
      ('apply a new total (apply_change_response)', 'update public.quote_requests set quote_amount = quote_amount - 1, deposit_target_cents = 100 where id = $1', false),
      ('settle the job (settleJobIfPaid)',   'update public.quote_requests set status = ''paid'', paid_at = now() where id = $1', false),
      ('freeze the fee (ensureFeeOnJob)',    'update public.quote_requests set fee_rate = 0.15, fee_total_cents = 0 where id = $1', false),
      ('replace the lines',                  'delete from public.quote_options where quote_id = $1', true),
      ('add a line',                         'insert into public.quote_options (quote_id, title, amount) values ($1, ''stage1 verify'', 1)', false)
    ) as v(label, stmt, empty_ok)
  loop
    begin
      execute t.stmt using job;
      get diagnostics n = row_count;
      if n = 0 and t.empty_ok then
        raise notice 'SKIP  E: % (no rows to try it on)', t.label;
      elsif n = 0 then
        bad := bad + 1;
        raise notice 'FAIL  E: % matched no rows', t.label;
      else
        raise notice 'PASS  E: server % allowed', t.label;
      end if;
      raise exception 'stage1_undo_one';
    exception when others then
      if sqlerrm <> 'stage1_undo_one' then
        bad := bad + 1;
        raise notice 'FAIL  E: server % raised % (%)', t.label, sqlstate, sqlerrm;
      end if;
    end;
  end loop;

  perform set_config('stage1.failures', (current_setting('stage1.failures')::int + bad)::text, true);
end;
$$;

reset role;

-- ── Verdict ─────────────────────────────────────────────────────────────────
do $$
begin
  if current_setting('stage1.failures')::int > 0 then
    raise exception 'stage 1 verify: % check(s) FAILED - read the notices above', current_setting('stage1.failures');
  end if;
  raise notice 'stage 1 verify: ALL PASSED (any SKIP lines above were not tested)';
end;
$$;

rollback;
