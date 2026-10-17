-- Raleigh Concrete Group - check stage 1 (price lockdown) on the real database
--
-- Run AFTER migrations/20261017221826_stage1_price_lockdown.sql, as the SQL editor's own role (postgres),
-- the whole file at once. It opens its own transaction and ends in ROLLBACK, and
-- every individual write inside is also undone on the spot (each one runs in
-- its own sub-transaction that is deliberately aborted), so nothing it does is
-- ever kept - not even if it stops half way. It never inserts a quote_requests
-- row: send_to_make posts every new one to an outside webhook, which a
-- rollback cannot take back. It only updates existing jobs and adds or changes
-- line items, which fire nothing outside the database.
--
-- What it does: picks real jobs by query (ids only - no customer details are
-- read or printed), then pretends to be
--   * the contractor assigned to an approved job,
--   * the contractor on a quote nobody has answered yet,
--   * the contractor on a job already marked Paid,
--   * the contractor on a declined quote the office has reopened,
--   * the owner, and
--   * the server (service role),
-- by setting the same JWT claims PostgREST would, and tries the writes each of
-- them can or cannot make. A refusal only counts as a PASS when it is the
-- guard's own message for that case - not row level security, not a constraint,
-- not some other 42501. Each line of output is PASS, FAIL or SKIP; the last
-- statement raises an error if anything FAILed, and says ALL PASSED otherwise.
--
-- A SKIP means there was nothing to test on (no job in that state, or a job
-- with no line items). It is not a failure, but it is not proof either.

begin;

-- ── The guard's messages, exactly as it raises them ─────────────────────────
select set_config('stage1.m_fee',      'the office fee is set by the office', true);
select set_config('stage1.m_test',     'is_test is set by the office', true);
select set_config('stage1.m_archive',  'archiving a lead is done by the office', true);
select set_config('stage1.m_paid',     'only the office can mark a job paid, or move it off paid', true);
select set_config('stage1.m_paid_at',  'paid_at is set from the payments ledger', true);
select set_config('stage1.m_deposit',  'the deposit is set by an approved change order', true);
select set_config('stage1.m_contact',  'the customer''s phone and email are changed by the office', true);
select set_config('stage1.m_price',    'the customer has approved this price; send a change order for them to approve', true);
select set_config('stage1.m_answer',   'the customer''s answer is on file and only the office can change it', true);
select set_config('stage1.m_pending',  'a change is already waiting on the customer; withdraw it first', true);
select set_config('stage1.m_own_name', 'a change order is sent in your own name', true);
select set_config('stage1.m_lower',    'lowering an approved price is done by the office', true);

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

-- ── What is installed ───────────────────────────────────────────────────────
-- Three triggers, and apply_change_response as one three-argument function
-- that only the server may call.
do $$
declare
  bad int := 0;
  n int;
begin
  select count(*) into n
    from pg_trigger t
   where not t.tgisinternal
     and t.tgname in ('qr_guard_money_columns', 'qo_guard_line_prices', 'qp_guard_line_prices');
  if n = 3 then
    raise notice 'PASS  0: the three guard triggers are installed';
  else
    bad := bad + 1;
    raise notice 'FAIL  0: % of the three guard triggers are installed', n;
  end if;

  select count(*) into n
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = 'apply_change_response';
  if n = 1 and to_regprocedure('public.apply_change_response(uuid,boolean,timestamptz)') is not null then
    raise notice 'PASS  0: apply_change_response(uuid, boolean, timestamptz) is the only version';
  else
    bad := bad + 1;
    raise notice 'FAIL  0: % apply_change_response version(s), expected only (uuid, boolean, timestamptz)', n;
  end if;

  if to_regprocedure('public.apply_change_response(uuid,boolean,timestamptz)') is not null then
    if not has_function_privilege('anon', 'public.apply_change_response(uuid,boolean,timestamptz)', 'execute')
       and not has_function_privilege('authenticated', 'public.apply_change_response(uuid,boolean,timestamptz)', 'execute')
       and has_function_privilege('service_role', 'public.apply_change_response(uuid,boolean,timestamptz)', 'execute') then
      raise notice 'PASS  0: apply_change_response is executable by service_role only';
    else
      bad := bad + 1;
      raise notice 'FAIL  0: apply_change_response is executable by anon or authenticated, or not by service_role';
    end if;
  end if;

  perform set_config('stage1.failures', (current_setting('stage1.failures')::int + bad)::text, true);
end;
$$;

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

  -- expect: 'allow' or the guard message it must be refused with. empty_ok:
  -- zero rows matched is a SKIP (line items the job may not have) rather than
  -- a failure.
  for t in
    select * from (values
      -- Refused: the price and the answer that locks it.
      ('price down',                         'update public.quote_requests set quote_amount = quote_amount - 1 where id = $1', current_setting('stage1.m_price'), false),
      ('price up',                           'update public.quote_requests set quote_amount = quote_amount + 1 where id = $1', current_setting('stage1.m_price'), false),
      ('decline credit',                     'update public.quote_requests set discount_accepted = not discount_accepted where id = $1', current_setting('stage1.m_price'), false),
      ('clear the answer',                   'update public.quote_requests set customer_response = null where id = $1', current_setting('stage1.m_answer'), false),
      ('flip the answer to declined',        'update public.quote_requests set customer_response = ''declined'' where id = $1', current_setting('stage1.m_answer'), false),
      ('restamp the answer',                 'update public.quote_requests set customer_responded_at = now() where id = $1', current_setting('stage1.m_answer'), false),
      ('clear the answer and reprice at once', 'update public.quote_requests set customer_response = null, quote_amount = 1 where id = $1', current_setting('stage1.m_price'), false),
      -- Refused: money and decisions that belong to the office or the ledger.
      ('mark paid',                          'update public.quote_requests set status = ''paid'' where id = $1', current_setting('stage1.m_paid'), false),
      ('stamp paid_at',                      'update public.quote_requests set paid_at = now() where id = $1', current_setting('stage1.m_paid_at'), false),
      ('deposit target',                     'update public.quote_requests set deposit_target_cents = coalesce(deposit_target_cents, 0) + 100 where id = $1', current_setting('stage1.m_deposit'), false),
      ('fee rate',                           'update public.quote_requests set fee_rate = 0 where id = $1', current_setting('stage1.m_fee'), false),
      ('fee total',                          'update public.quote_requests set fee_total_cents = 0 where id = $1', current_setting('stage1.m_fee'), false),
      ('fee waiver',                         'update public.quote_requests set fee_waived_cents = fee_waived_cents + 1 where id = $1', current_setting('stage1.m_fee'), false),
      ('practice flag',                      'update public.quote_requests set is_test = not is_test where id = $1', current_setting('stage1.m_test'), false),
      ('archive',                            'update public.quote_requests set archived_at = now() where id = $1', current_setting('stage1.m_archive'), false),
      ('customer phone',                     'update public.quote_requests set phone = phone || ''0'' where id = $1', current_setting('stage1.m_contact'), false),
      ('customer email',                     'update public.quote_requests set email = coalesce(email, '''') || ''x'' where id = $1', current_setting('stage1.m_contact'), false),
      -- Refused: a change order the contractor could approve themselves at a
      -- lower total, or one opened in somebody else's name.
      ('lower change order',                 'update public.quote_requests set change_note = ''stage1 verify'', change_amount = quote_amount - 1, change_requested_at = now(), change_requested_by = auth.uid() where id = $1', current_setting('stage1.m_lower'), false),
      ('change order to $0',                 'update public.quote_requests set change_note = ''stage1 verify'', change_amount = 0, change_requested_at = now(), change_requested_by = auth.uid() where id = $1', current_setting('stage1.m_lower'), false),
      ('change order in another name',       'update public.quote_requests set change_note = ''stage1 verify'', change_amount = quote_amount + 100, change_requested_at = now(), change_requested_by = coalesce(nullif(current_setting(''stage1.owner''), '''')::uuid, gen_random_uuid()) where id = $1', current_setting('stage1.m_own_name'), false),
      ('change order in no name',            'update public.quote_requests set change_note = ''stage1 verify'', change_amount = quote_amount + 100, change_requested_at = now(), change_requested_by = null where id = $1', current_setting('stage1.m_own_name'), false),
      -- Refused: the priced lines behind the approved price, by any route.
      ('add a line item',                    'insert into public.quote_options (quote_id, title, amount) values ($1, ''stage1 verify'', 1)', current_setting('stage1.m_price'), false),
      ('add an option',                      'insert into public.quote_packages (quote_id, title, amount) values ($1, ''stage1 verify'', 1)', current_setting('stage1.m_price'), false),
      ('upsert a new line item',             'insert into public.quote_options (id, quote_id, title, amount) values (gen_random_uuid(), $1, ''stage1 verify'', 1) on conflict (id) do update set amount = excluded.amount', current_setting('stage1.m_price'), false),
      ('upsert a new option',                'insert into public.quote_packages (id, quote_id, title, amount) values (gen_random_uuid(), $1, ''stage1 verify'', 1) on conflict (id) do update set amount = excluded.amount', current_setting('stage1.m_price'), false),
      ('upsert over a line item',            'insert into public.quote_options (id, quote_id, title, amount) select id, quote_id, title, amount + 1 from public.quote_options where quote_id = $1 on conflict (id) do update set amount = excluded.amount', current_setting('stage1.m_price'), true),
      ('upsert over an option',              'insert into public.quote_packages (id, quote_id, title, amount) select id, quote_id, title, amount + 1 from public.quote_packages where quote_id = $1 on conflict (id) do update set amount = excluded.amount', current_setting('stage1.m_price'), true),
      ('reprice a line item',                'update public.quote_options set amount = amount + 1 where quote_id = $1', current_setting('stage1.m_price'), true),
      ('remove a line item',                 'delete from public.quote_options where quote_id = $1', current_setting('stage1.m_price'), true),
      ('reprice an option',                  'update public.quote_packages set amount = amount + 1 where quote_id = $1', current_setting('stage1.m_price'), true),
      ('move a line item to another job',    'update public.quote_options set quote_id = coalesce(nullif(current_setting(''stage1.open_job''), '''')::uuid, gen_random_uuid()) where quote_id = $1', current_setting('stage1.m_price'), true),
      ('move an option to another job',      'update public.quote_packages set quote_id = coalesce(nullif(current_setting(''stage1.open_job''), '''')::uuid, gen_random_uuid()) where quote_id = $1', current_setting('stage1.m_price'), true),

      -- Allowed: everything the crew do on an approved job today.
      ('private notes',                      'update public.quote_requests set internal_notes = coalesce(internal_notes, '''') || '' '' where id = $1', 'allow', false),
      ('same price written back',            'update public.quote_requests set quote_amount = quote_amount where id = $1', 'allow', false),
      ('same phone and email written back',  'update public.quote_requests set phone = phone, email = email where id = $1', 'allow', false),
      ('book the day (confirmSchedule)',     'update public.quote_requests set status = case when status in (''completed'', ''paid'') then status else ''scheduled'' end, scheduled_by = auth.uid(), scheduled_at = now(), confirmed_at = null, reminder_sent_at = null where id = $1', 'allow', false),
      ('release the day (clearAppointment)', 'update public.quote_requests set scheduled_date = null, scheduled_time = null, scheduled_by = null, scheduled_at = null, confirmed_at = null, reminder_sent_at = null, status = case when status = ''scheduled'' then ''approved'' else status end where id = $1', 'allow', false),
      ('mark it done (completeJob)',         'update public.quote_requests set status = ''completed'', completed_at = now() where id = $1', 'allow', false),
      ('visit reminders (confirmVisit)',     'update public.quote_requests set visit_reminder_sent_at = null, visit_crew_reminded_at = null where id = $1', 'allow', false),
      ('photos (addJobPhotos)',              'update public.quote_requests set before_urls = before_urls, after_urls = after_urls where id = $1', 'allow', false),
      ('rotate links (rotateTokens)',        'update public.quote_requests set public_token = replace(gen_random_uuid()::text, ''-'', ''''), job_token = replace(gen_random_uuid()::text, ''-'', '''') where id = $1', 'allow', false),
      ('ask for payment (sendPayLink)',      'update public.quote_requests set payment_requested_at = now() where id = $1', 'allow', false),
      ('higher change order (requestChange)', 'update public.quote_requests set change_note = ''stage1 verify'', change_amount = quote_amount + 100, change_requested_at = now(), change_requested_by = auth.uid() where id = $1', 'allow', false),
      ('same-total change, new breakdown',   'update public.quote_requests set change_note = ''stage1 verify'', change_amount = quote_amount, change_lines = ''[]''::jsonb, change_requested_at = now(), change_requested_by = auth.uid() where id = $1', 'allow', false),
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
    exception when others then
      if sqlerrm = 'stage1_undo_one' then
        null;
      elsif t.expect <> 'allow' and sqlstate = '42501' and sqlerrm = t.expect then
        raise notice 'PASS  A: % refused (%)', t.label, sqlerrm;
      else
        bad := bad + 1;
        raise notice 'FAIL  A: % raised % (%), expected %', t.label, sqlstate, sqlerrm, t.expect;
      end if;
    end;
  end loop;

  -- A change already in front of the customer: open one (allowed), rewrite it
  -- in place (refused), withdraw it (allowed), and open a lower one in its
  -- place (refused). One sub-transaction, undone.
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
      if sqlerrm = current_setting('stage1.m_pending') then
        raise notice 'PASS  A: rewriting a pending change refused (%)', sqlerrm;
      else
        bad := bad + 1;
        raise notice 'FAIL  A: rewriting a pending change refused for the wrong reason (%)', sqlerrm;
      end if;
    end;
    begin
      update public.quote_requests set change_lines = '[]'::jsonb where id = job;
      bad := bad + 1;
      raise notice 'FAIL  A: adding lines to a pending change was ALLOWED';
    exception when insufficient_privilege then
      if sqlerrm = current_setting('stage1.m_pending') then
        raise notice 'PASS  A: adding lines to a pending change refused (%)', sqlerrm;
      else
        bad := bad + 1;
        raise notice 'FAIL  A: adding lines to a pending change refused for the wrong reason (%)', sqlerrm;
      end if;
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
    begin
      update public.quote_requests
         set change_note = 'stage1 verify', change_amount = quote_amount - 1,
             change_requested_at = now(), change_requested_by = auth.uid()
       where id = job;
      bad := bad + 1;
      raise notice 'FAIL  A: a lower change after withdrawing was ALLOWED';
    exception when insufficient_privilege then
      if sqlerrm = current_setting('stage1.m_lower') then
        raise notice 'PASS  A: a lower change after withdrawing refused (%)', sqlerrm;
      else
        bad := bad + 1;
        raise notice 'FAIL  A: a lower change after withdrawing refused for the wrong reason (%)', sqlerrm;
      end if;
    end;
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
      ('lower the quote',                    'update public.quote_requests set quote_amount = greatest(coalesce(quote_amount, 0) - 1, 0) where id = $1', 'allow', false),
      ('clear the price',                    'update public.quote_requests set quote_amount = null where id = $1', 'allow', false),
      ('send it (status quoted)',            'update public.quote_requests set status = ''quoted'', quote_sent_at = now(), quote_expires_at = now() + interval ''10 days'', quote_followup_sent_at = null where id = $1', 'allow', false),
      ('phone approval (recordOfflineAcceptance)', 'update public.quote_requests set customer_response = ''accepted'', customer_responded_at = now(), status = ''approved'', quote_amount = coalesce(quote_amount, 0) + 1 where id = $1', 'allow', false),
      ('add a line item',                    'insert into public.quote_options (quote_id, title, amount) values ($1, ''stage1 verify'', 1)', 'allow', false),
      ('add an option',                      'insert into public.quote_packages (quote_id, title, amount) values ($1, ''stage1 verify'', 1)', 'allow', false),
      ('upsert a new line item',             'insert into public.quote_options (id, quote_id, title, amount) values (gen_random_uuid(), $1, ''stage1 verify'', 1) on conflict (id) do update set amount = excluded.amount', 'allow', false),
      ('upsert over a line item',            'insert into public.quote_options (id, quote_id, title, amount) select id, quote_id, title, amount + 1 from public.quote_options where quote_id = $1 on conflict (id) do update set amount = excluded.amount', 'allow', true),
      ('reprice a line item',                'update public.quote_options set amount = amount + 1 where quote_id = $1', 'allow', true),
      ('mark paid',                          'update public.quote_requests set status = ''paid'' where id = $1', current_setting('stage1.m_paid'), false),
      ('stamp paid_at',                      'update public.quote_requests set paid_at = now() where id = $1', current_setting('stage1.m_paid_at'), false),
      ('deposit target',                     'update public.quote_requests set deposit_target_cents = 100 where id = $1', current_setting('stage1.m_deposit'), false),
      ('fee rate',                           'update public.quote_requests set fee_rate = 0 where id = $1', current_setting('stage1.m_fee'), false),
      ('customer phone',                     'update public.quote_requests set phone = phone || ''0'' where id = $1', current_setting('stage1.m_contact'), false),
      ('customer email',                     'update public.quote_requests set email = coalesce(email, '''') || ''x'' where id = $1', current_setting('stage1.m_contact'), false)
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
    exception when others then
      if sqlerrm = 'stage1_undo_one' then
        null;
      elsif t.expect <> 'allow' and sqlstate = '42501' and sqlerrm = t.expect then
        raise notice 'PASS  B: % refused (%)', t.label, sqlerrm;
      else
        bad := bad + 1;
        raise notice 'FAIL  B: % raised % (%), expected %', t.label, sqlstate, sqlerrm, t.expect;
      end if;
    end;
  end loop;

  -- Moving one of this quote's lines onto an approved job prices that job too.
  if current_setting('stage1.job') = '' then
    raise notice 'SKIP  B: moving a line onto an approved job (no approved job)';
  else
    begin
      update public.quote_options set quote_id = current_setting('stage1.job')::uuid where quote_id = job;
      get diagnostics n = row_count;
      if n = 0 then
        raise notice 'SKIP  B: moving a line onto an approved job (no rows to try it on)';
      else
        bad := bad + 1;
        raise notice 'FAIL  B: moving a line onto an approved job was ALLOWED';
      end if;
      raise exception 'stage1_undo_one';
    exception when others then
      if sqlerrm = 'stage1_undo_one' then
        null;
      elsif sqlstate = '42501' and sqlerrm = current_setting('stage1.m_price') then
        raise notice 'PASS  B: moving a line onto an approved job refused (%)', sqlerrm;
      else
        bad := bad + 1;
        raise notice 'FAIL  B: moving a line onto an approved job raised % (%)', sqlstate, sqlerrm;
      end if;
    end;
  end if;

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
      ('move it off paid',                   'update public.quote_requests set status = ''completed'' where id = $1', current_setting('stage1.m_paid')),
      ('clear paid_at',                      'update public.quote_requests set paid_at = null where id = $1', current_setting('stage1.m_paid_at')),
      ('private notes',                      'update public.quote_requests set internal_notes = coalesce(internal_notes, '''') || '' '' where id = $1', 'allow')
    ) as v(label, stmt, expect)
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
    exception when others then
      if sqlerrm = 'stage1_undo_one' then
        null;
      elsif t.expect <> 'allow' and sqlstate = '42501' and sqlerrm = t.expect then
        raise notice 'PASS  C: % refused (%)', t.label, sqlerrm;
      else
        bad := bad + 1;
        raise notice 'FAIL  C: % raised % (%), expected %', t.label, sqlstate, sqlerrm, t.expect;
      end if;
    end;
  end loop;

  perform set_config('stage1.failures', (current_setting('stage1.failures')::int + bad)::text, true);
end;
$$;

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- F. The contractor on a DECLINED quote the office has REOPENED
-- ════════════════════════════════════════════════════════════════════════════
-- Made from the unanswered quote above, as the server (no claims), and kept
-- only until the final ROLLBACK. Section B is done with that quote by now.
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '', true);
update public.quote_requests
   set customer_response = 'declined', customer_responded_at = now(), status = 'quoted'
 where id = nullif(current_setting('stage1.open_job'), '')::uuid;

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
    raise notice 'SKIP  F: no unanswered quote to reopen';
    return;
  end if;

  for t in
    select * from (values
      ('reprice the quote',                  'update public.quote_requests set quote_amount = coalesce(quote_amount, 0) + 1 where id = $1', 'allow', false),
      ('save clears the old no (saveQuote)', 'update public.quote_requests set customer_response = null, customer_responded_at = null, discount_accepted = false, quote_amount = coalesce(quote_amount, 0) + 1 where id = $1', 'allow', false),
      ('add a line item',                    'insert into public.quote_options (quote_id, title, amount) values ($1, ''stage1 verify'', 1)', 'allow', false),
      ('reprice a line item',                'update public.quote_options set amount = amount + 1 where quote_id = $1', 'allow', true),
      ('customer phone',                     'update public.quote_requests set phone = phone || ''0'' where id = $1', current_setting('stage1.m_contact'), false),
      ('mark paid',                          'update public.quote_requests set status = ''paid'' where id = $1', current_setting('stage1.m_paid'), false)
    ) as v(label, stmt, expect, empty_ok)
  loop
    begin
      execute t.stmt using job;
      get diagnostics n = row_count;
      if n = 0 and t.empty_ok then
        raise notice 'SKIP  F: % (no rows to try it on)', t.label;
      elsif n = 0 then
        bad := bad + 1;
        raise notice 'FAIL  F: % matched no rows - the job is not visible to its contractor', t.label;
      elsif t.expect = 'allow' then
        raise notice 'PASS  F: % allowed', t.label;
      else
        bad := bad + 1;
        raise notice 'FAIL  F: % was ALLOWED', t.label;
      end if;
      raise exception 'stage1_undo_one';
    exception when others then
      if sqlerrm = 'stage1_undo_one' then
        null;
      elsif t.expect <> 'allow' and sqlstate = '42501' and sqlerrm = t.expect then
        raise notice 'PASS  F: % refused (%)', t.label, sqlerrm;
      else
        bad := bad + 1;
        raise notice 'FAIL  F: % raised % (%), expected %', t.label, sqlstate, sqlerrm, t.expect;
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
      ('customer phone and email',           'update public.quote_requests set phone = phone || ''0'', email = coalesce(email, '''') || ''x'' where id = $1', false),
      ('lower change order',                 'update public.quote_requests set change_note = ''stage1 verify'', change_amount = quote_amount - 1, change_requested_at = now(), change_requested_by = auth.uid() where id = $1', false),
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
  r jsonb;
  shown timestamptz;
  row_after public.quote_requests;
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

  -- The customer's Approve, from a page showing a different change than the
  -- one now on the job: 'stale', and nothing written. Then from a page showing
  -- this one, and from an old page that sends no timestamp: both apply.
  begin
    update public.quote_requests
       set change_note = 'stage1 verify', change_amount = quote_amount + 100,
           change_requested_at = now(), change_requested_by = nullif(current_setting('stage1.crew'), '')::uuid
     where id = job
    returning change_requested_at into shown;

    r := public.apply_change_response(job, true, shown - interval '1 second');
    select * into row_after from public.quote_requests where id = job;
    if r->>'status' = 'stale' and row_after.change_requested_at = shown and row_after.change_amount is not null then
      raise notice 'PASS  E: approving a change the page did not show returns stale, nothing written';
    else
      bad := bad + 1;
      raise notice 'FAIL  E: stale approve returned % (change still pending: %)', r->>'status', row_after.change_requested_at is not null;
    end if;

    r := public.apply_change_response(job, false, shown - interval '1 second');
    if r->>'status' = 'stale' then
      raise notice 'PASS  E: declining a change the page did not show returns stale';
    else
      bad := bad + 1;
      raise notice 'FAIL  E: stale decline returned %', r->>'status';
    end if;

    r := public.apply_change_response(job, true, shown);
    select * into row_after from public.quote_requests where id = job;
    if r->>'status' = 'ok' and row_after.change_requested_at is null
       and row_after.quote_amount = (r->>'to')::numeric then
      raise notice 'PASS  E: approving the change the page showed applies it';
    else
      bad := bad + 1;
      raise notice 'FAIL  E: matching approve returned %', r->>'status';
    end if;
    raise exception 'stage1_undo_one';
  exception when others then
    if sqlerrm <> 'stage1_undo_one' then
      bad := bad + 1;
      raise notice 'FAIL  E: change response sequence raised % (%)', sqlstate, sqlerrm;
    end if;
  end;

  begin
    update public.quote_requests
       set change_note = 'stage1 verify', change_amount = quote_amount + 100,
           change_requested_at = now(), change_requested_by = nullif(current_setting('stage1.crew'), '')::uuid
     where id = job;
    r := public.apply_change_response(job, true);
    if r->>'status' = 'ok' then
      raise notice 'PASS  E: an old page (no timestamp) still applies the pending change';
    else
      bad := bad + 1;
      raise notice 'FAIL  E: two-argument call returned %', r->>'status';
    end if;
    raise exception 'stage1_undo_one';
  exception when others then
    if sqlerrm <> 'stage1_undo_one' then
      bad := bad + 1;
      raise notice 'FAIL  E: two-argument change response raised % (%)', sqlstate, sqlerrm;
    end if;
  end;

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
