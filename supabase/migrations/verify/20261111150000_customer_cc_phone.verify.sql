-- Check customer_cc_phone on the real database. Run AFTER the migration, as the SQL editor's own role (postgres),
-- the whole file at once. It ends in ROLLBACK and every write inside is undone on the spot, so nothing is kept.
-- It never inserts a quote_requests row (send_to_make would post it to an outside webhook). It reads ids only, no
-- customer details. Each line is PASS, FAIL or SKIP; the last statement raises if anything FAILed.

begin;

select set_config('cc.failures', '0', true);

-- ── Structure ───────────────────────────────────────────────────────────────
do $$
declare
  bad int := 0;
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'quote_requests'
              and column_name = 'cc_phone' and data_type = 'text' and is_nullable = 'YES') then
    raise notice 'PASS  0: quote_requests.cc_phone exists, text, nullable';
  else
    bad := bad + 1; raise notice 'FAIL  0: quote_requests.cc_phone missing or the wrong type';
  end if;
  if exists (select 1 from pg_constraint where conname = 'qr_cc_phone_chk' and conrelid = 'public.quote_requests'::regclass) then
    raise notice 'PASS  0: qr_cc_phone_chk present';
  else
    bad := bad + 1; raise notice 'FAIL  0: qr_cc_phone_chk missing';
  end if;
  if exists (select 1 from pg_trigger where tgname = 'qr_guard_cc_phone' and tgrelid = 'public.quote_requests'::regclass
              and tgenabled = 'O') then
    raise notice 'PASS  0: qr_guard_cc_phone trigger installed and enabled';
  else
    bad := bad + 1; raise notice 'FAIL  0: qr_guard_cc_phone trigger missing or disabled';
  end if;
  if exists (select 1 from pg_trigger where tgname = 'qr_guard_money_columns' and tgrelid = 'public.quote_requests'::regclass
              and tgenabled = 'O') then
    raise notice 'PASS  0: qr_guard_money_columns still installed and enabled';
  else
    bad := bad + 1; raise notice 'FAIL  0: qr_guard_money_columns missing or disabled';
  end if;
  if not has_function_privilege('anon', 'public.guard_quote_cc_phone()', 'execute')
     and not has_function_privilege('authenticated', 'public.guard_quote_cc_phone()', 'execute') then
    raise notice 'PASS  0: guard_quote_cc_phone() not executable by anon or authenticated';
  else
    bad := bad + 1; raise notice 'FAIL  0: guard_quote_cc_phone() is executable by anon or authenticated';
  end if;
  perform set_config('cc.failures', (current_setting('cc.failures')::int + bad)::text, true);
end;
$$;

-- ── Fixtures (ids only) ─────────────────────────────────────────────────────
select set_config('cc.job', coalesce((
  select q.id::text
    from public.quote_requests q
    join public.staff s on s.id = q.assigned_to and s.role = 'contractor' and s.active
   where q.archived_at is null and q.status <> 'paid'
   order by q.is_test desc, q.updated_at desc
   limit 1), ''), true);
select set_config('cc.crew', coalesce((
  select q.assigned_to::text from public.quote_requests q where q.id::text = current_setting('cc.job')), ''), true);
select set_config('cc.owner', coalesce((
  select s.id::text from public.staff s where s.role = 'owner' and s.active order by s.created_at limit 1), ''), true);

-- ── A. The assigned contractor: refused, with the guard's own message ───────
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('cc.crew'), 'role', 'authenticated')::text, true);
set local role authenticated;

do $$
declare
  job uuid := nullif(current_setting('cc.job'), '')::uuid;
  bad int := 0;
  n bigint;
begin
  if job is null then
    raise notice 'SKIP  A: no job assigned to an active contractor';
    return;
  end if;
  begin
    update public.quote_requests set cc_phone = '+19195550100' where id = job;
    get diagnostics n = row_count;
    bad := bad + 1;
    raise notice 'FAIL  A: the contractor set the second number (% row)', n;
  exception
    when insufficient_privilege then
      if sqlerrm = 'the customer''s second number is changed by the office' then
        raise notice 'PASS  A: the contractor cannot set the second number';
      else
        bad := bad + 1; raise notice 'FAIL  A: refused, but not by the guard: %', sqlerrm;
      end if;
  end;
  -- A save that doesn't touch the number still works for them (internal notes are the crew's).
  begin
    update public.quote_requests set internal_notes = internal_notes where id = job;
    raise notice 'PASS  A: the contractor can still save the job without touching the number';
    raise exception 'cc verify rollback' using errcode = 'P0001';
  exception
    when raise_exception then
      if sqlerrm <> 'cc verify rollback' then bad := bad + 1; raise notice 'FAIL  A: %', sqlerrm; end if;
    when others then
      bad := bad + 1; raise notice 'FAIL  A: an unrelated save was refused: %', sqlerrm;
  end;
  perform set_config('cc.failures', (current_setting('cc.failures')::int + bad)::text, true);
end;
$$;
reset role;

-- ── B. The owner: allowed ───────────────────────────────────────────────────
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('cc.owner'), 'role', 'authenticated')::text, true);
set local role authenticated;

do $$
declare
  job uuid := nullif(current_setting('cc.job'), '')::uuid;
  bad int := 0;
  n bigint;
begin
  if job is null or current_setting('cc.owner') = '' then
    raise notice 'SKIP  B: no job or no active owner';
    return;
  end if;
  begin
    update public.quote_requests set cc_phone = '+19195550100' where id = job;
    get diagnostics n = row_count;
    if n = 1 then raise notice 'PASS  B: the owner can set the second number';
    else bad := bad + 1; raise notice 'FAIL  B: the owner''s update matched % rows', n; end if;
    raise exception 'cc verify rollback' using errcode = 'P0001';
  exception
    when raise_exception then
      if sqlerrm <> 'cc verify rollback' then bad := bad + 1; raise notice 'FAIL  B: %', sqlerrm; end if;
    when others then
      bad := bad + 1; raise notice 'FAIL  B: the owner was refused: %', sqlerrm;
  end;
  begin
    update public.quote_requests set cc_phone = '123' where id = job;
    bad := bad + 1; raise notice 'FAIL  B: a 3-character number was accepted';
  exception
    when check_violation then raise notice 'PASS  B: qr_cc_phone_chk refuses a too-short number';
  end;
  perform set_config('cc.failures', (current_setting('cc.failures')::int + bad)::text, true);
end;
$$;
reset role;

-- ── C. The server (service role): allowed ───────────────────────────────────
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
set local role service_role;

do $$
declare
  job uuid := nullif(current_setting('cc.job'), '')::uuid;
  bad int := 0;
begin
  if job is null then
    raise notice 'SKIP  C: no job';
    return;
  end if;
  begin
    update public.quote_requests set cc_phone = null where id = job;
    raise notice 'PASS  C: the server can change the second number';
    raise exception 'cc verify rollback' using errcode = 'P0001';
  exception
    when raise_exception then
      if sqlerrm <> 'cc verify rollback' then bad := bad + 1; raise notice 'FAIL  C: %', sqlerrm; end if;
    when others then
      bad := bad + 1; raise notice 'FAIL  C: the server was refused: %', sqlerrm;
  end;
  perform set_config('cc.failures', (current_setting('cc.failures')::int + bad)::text, true);
end;
$$;
reset role;

do $$
begin
  if current_setting('cc.failures')::int > 0 then
    raise exception '% check(s) FAILED', current_setting('cc.failures');
  end if;
  raise notice 'ALL PASSED';
end;
$$;

rollback;
