-- ═══════════════════════════════════════════════════════════════════════════
-- Raleigh Concrete Group - full health check
-- Run in Supabase → SQL Editor. READ ONLY. Nothing in this file changes a row.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- HOW TO USE IT
--
-- The SQL editor only shows you the result of the LAST statement it ran, so a
-- file of forty selects would hide thirty-nine of them. This one is built the
-- other way round:
--
--   PART 0  does the database have the columns the app expects. Run it first.
--           Safe on any database - it reads the catalogue, never your tables.
--   PART 1  ONE query, ONE result: every check, with a count against it.
--           This is the file. Run it, read the top of the list.
--   PART 2  the totals the Money page claims, worked out here instead, so the
--           two can be compared. If they disagree, one of them is wrong.
--   PART 3  a drill-down per check. Highlight and run only the ones PART 1
--           gave you a number for.
--
-- Test leads are excluded everywhere, exactly as the app excludes them, and
-- counted separately at the bottom of PART 1 so nothing is silently dropped.
-- Fixes live in money-audit.sql and test-data.sql; this file only ever looks.


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 0 - IS THE SCHEMA UP TO DATE
-- ═══════════════════════════════════════════════════════════════════════════
-- Reads the catalogue rather than the tables, so it cannot fail no matter how
-- far behind the database is. Anything marked MISSING means PART 1 will error
-- on the sections that use it: run that file first.
with needed(feature, migration, obj, col) as (
  values
    ('Leads',            'crm.sql',              'quote_requests', 'status'),
    ('Activity log',     'crm.sql',              'quote_events',   'type'),
    ('Quote sections',   'quote-detail.sql',     'quote_requests', 'quote_scope'),
    ('Line items',       'quote-options.sql',    'quote_options',  'required'),
    ('Scheduling',       'scheduling.sql',       'quote_requests', 'preferred_dates'),
    ('Start times',      'scheduled-time.sql',   'quote_requests', 'preferred_times'),
    ('Appointments',     'appointments.sql',     'quote_requests', 'visit_date'),
    ('Crew reminders',   'crew-reminders.sql',   'quote_requests', 'crew_reminders'),
    ('Message log',      'message-log.sql',      'quote_messages', 'kind'),
    ('Quiet hours',      'quiet-hours.sql',      'quote_messages', 'send_after'),
    ('Cancel a text',    'cancel-held-text.sql', 'quote_messages', 'cancelled_at'),
    ('Payments',         'payments.sql',         'quote_payments', 'fee_cents'),
    ('Fee settlements',  'payments.sql',         'fee_settlements','amount_cents'),
    ('Fee rate on job',  'payments.sql',         'quote_requests', 'fee_rate'),
    ('Test leads',       'test-data.sql',        'quote_requests', 'is_test'),
    ('Agreements',       'agreements.sql',       'agreements',     'status'),
    ('Contractor invites','invites.sql',         'contractor_invites','token'),
    ('Invite tracking',  'invite-tracking.sql',  'contractor_invites','open_count'),
    ('Staff hours',      'scheduling.sql',       'staff',          'work_start_hour'),
    ('Staff locale',     'locale.sql',           'staff',          'locale'),
    ('Stripe Connect',   'payments.sql',         'staff',          'stripe_account_id')
)
select
  n.feature,
  n.migration,
  n.obj || '.' || n.col as needs,
  case
    when to_regclass('public.' || n.obj) is null then 'TABLE MISSING - run it'
    when not exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = n.obj and c.column_name = n.col
    ) then 'COLUMN MISSING - run it'
    else 'ok'
  end as state
from needed n
order by (case
    when to_regclass('public.' || n.obj) is null then 0
    when not exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = n.obj and c.column_name = n.col
    ) then 0
    else 1 end), n.feature;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 1 - THE SCOREBOARD
-- ═══════════════════════════════════════════════════════════════════════════
-- One row per check, worst first. `n` is how many rows are in that state.
--
--   problem  should be zero. A number here is a figure somewhere that cannot
--            be justified, or a job in a state the app did not intend.
--   review   worth a look, not necessarily wrong.
--   info     context. A number here is neither good nor bad.
--
-- The `ref` column matches a heading in PART 3.
with checks(area, ref, check_name, kind, n) as (

  -- ── MONEY ────────────────────────────────────────────────────────────────
  select 'Money', 'M1', 'Marked paid, but no payment ever recorded', 'problem',
    (select count(*) from public.quote_requests q
      where q.customer_response = 'accepted' and q.status <> 'lost' and not q.is_test
        and (q.status = 'paid' or q.paid_at is not null)
        and not exists (select 1 from public.quote_payments p
                         where p.quote_id = q.id and p.status in ('paid','refunded')))
  union all select 'Money', 'M2', 'Approved by the customer with no price on it', 'problem',
    (select count(*) from public.quote_requests q
      where q.customer_response = 'accepted' and q.status <> 'lost' and not q.is_test
        and coalesce(q.quote_amount, 0) <= 0)
  union all select 'Money', 'M3', 'Payments against a job that left the pipeline', 'review',
    (select count(*) from public.quote_payments p
      join public.quote_requests q on q.id = p.quote_id
     where p.status in ('paid','refunded') and not q.is_test
       and (q.customer_response is distinct from 'accepted' or q.status = 'lost' or q.archived_at is not null))
  union all select 'Money', 'M4', 'Took money but the office never set a rate', 'problem',
    (select count(*) from public.quote_requests q
      where q.fee_rate is null and not q.is_test
        and exists (select 1 from public.quote_payments p where p.quote_id = q.id and p.status = 'paid'))
  union all select 'Money', 'M5', 'Fee stamp no longer matches rate x price', 'review',
    (select count(*) from public.quote_requests q
      where q.fee_rate is not null and not q.is_test
        and q.fee_total_cents is distinct from round(coalesce(q.quote_amount,0) * 100 * q.fee_rate))
  union all select 'Money', 'M6', 'Collected more than the job is worth', 'problem',
    (select count(*) from (
        select q.id from public.quote_requests q
          join public.quote_payments p on p.quote_id = q.id and p.status in ('paid','refunded')
         where q.customer_response = 'accepted' and q.status <> 'lost' and not q.is_test
         group by q.id, q.quote_amount
        having sum(p.amount_cents - p.refunded_cents) > round(coalesce(q.quote_amount,0) * 100)) x)
  union all select 'Money', 'M7', 'Payments that look like duplicates', 'review',
    (select count(*) from public.quote_payments p1
      join public.quote_payments p2 on p2.quote_id = p1.quote_id and p2.method = p1.method
        and p2.amount_cents = p1.amount_cents and p2.id > p1.id
        and p2.created_at between p1.created_at - interval '10 minutes' and p1.created_at + interval '10 minutes'
      join public.quote_requests q on q.id = p1.quote_id
     where p1.status in ('paid','refunded') and p2.status in ('paid','refunded') and not q.is_test)
  union all select 'Money', 'M8', 'Checkouts opened days ago and never finished', 'review',
    (select count(*) from public.quote_payments p
      join public.quote_requests q on q.id = p.quote_id
     where p.status = 'pending' and not q.is_test and p.created_at < now() - interval '2 days')
  union all select 'Money', 'M9', 'Refunded more than was taken', 'problem',
    (select count(*) from public.quote_payments p where p.refunded_cents > p.amount_cents)
  union all select 'Money', 'M10', 'A fee taken on something that was not a card', 'problem',
    (select count(*) from public.quote_payments p where p.method <> 'card' and p.fee_cents > 0)
  union all select 'Money', 'M11', 'Contractor sent over more fee than they owed', 'review',
    (select count(*) from (
        select s.staff_id, sum(s.amount_cents) as sent
          from public.fee_settlements s group by s.staff_id) st
     where st.sent > coalesce((
        select sum(least(round(coalesce(q.quote_amount,0) * 100 * coalesce(q.fee_rate,0)),
                         coalesce((select sum(p.amount_cents - p.refunded_cents) from public.quote_payments p
                                    where p.quote_id = q.id and p.status in ('paid','refunded')), 0)))
          from public.quote_requests q
         where q.assigned_to = st.staff_id and not q.is_test), 0))

  -- ── PIPELINE ─────────────────────────────────────────────────────────────
  union all select 'Pipeline', 'P1', 'Scheduled, but with no work day on it', 'problem',
    (select count(*) from public.quote_requests q
      where q.status = 'scheduled' and q.scheduled_date is null and not q.is_test and q.archived_at is null)
  union all select 'Pipeline', 'P2', 'Quoted with no price', 'problem',
    (select count(*) from public.quote_requests q
      where q.status = 'quoted' and coalesce(q.quote_amount,0) <= 0 and not q.is_test and q.archived_at is null)
  union all select 'Pipeline', 'P3', 'Quoted but never actually sent', 'review',
    (select count(*) from public.quote_requests q
      where q.status = 'quoted' and q.quote_sent_at is null and not q.is_test and q.archived_at is null)
  union all select 'Pipeline', 'P4', 'Customer accepted but the job never moved on', 'problem',
    (select count(*) from public.quote_requests q
      where q.customer_response = 'accepted' and q.status in ('new','quoted')
        and not q.is_test and q.archived_at is null)
  union all select 'Pipeline', 'P5', 'Closed out with no before/after photos', 'review',
    (select count(*) from public.quote_requests q
      where q.status in ('completed','paid') and not q.is_test
        and (coalesce(array_length(q.before_urls,1),0) = 0 or coalesce(array_length(q.after_urls,1),0) = 0))
  union all select 'Pipeline', 'P6', 'Marked paid without being completed first', 'review',
    (select count(*) from public.quote_requests q
      where q.status = 'paid' and q.completed_at is null and not q.is_test)
  union all select 'Pipeline', 'P7', 'Lost, but still holding a future appointment', 'problem',
    (select count(*) from public.quote_requests q
      where q.status = 'lost' and not q.is_test
        and (q.scheduled_date >= current_date or q.visit_date >= current_date))
  union all select 'Pipeline', 'P8', 'Archived but still on somebody''s list', 'review',
    (select count(*) from public.quote_requests q
      where q.archived_at is not null and (q.scheduled_date >= current_date or q.visit_date >= current_date))
  union all select 'Pipeline', 'P9', 'Approved with no days the customer offered', 'review',
    (select count(*) from public.quote_requests q
      where q.customer_response = 'accepted' and q.scheduled_date is null and q.status <> 'lost'
        and not q.is_test and q.archived_at is null
        and coalesce(array_length(q.preferred_dates,1),0) = 0)

  -- ── SCHEDULING ───────────────────────────────────────────────────────────
  union all select 'Scheduling', 'S1', 'Two jobs booked on the same day', 'problem',
    (select count(*) from (
        select q.scheduled_date from public.quote_requests q
         where q.scheduled_date is not null and q.customer_response = 'accepted'
           and q.status <> 'lost' and not q.is_test
         group by q.scheduled_date having count(*) > 1) d)
  union all select 'Scheduling', 'S2', 'Work day is in the past and the job is still open', 'problem',
    (select count(*) from public.quote_requests q
      where q.status = 'scheduled' and q.scheduled_date < current_date and not q.is_test and q.archived_at is null)
  union all select 'Scheduling', 'S3', 'Quote visit has passed with no price sent', 'review',
    (select count(*) from public.quote_requests q
      where q.visit_date < current_date and q.status = 'new' and not q.is_test and q.archived_at is null)
  union all select 'Scheduling', 'S4', 'More than five visits on one day', 'review',
    (select count(*) from (
        select q.visit_date from public.quote_requests q
         where q.visit_date is not null and q.status <> 'lost' and not q.is_test
         group by q.visit_date having count(*) > 5) d)
  union all select 'Scheduling', 'S5', 'Booked work day with nobody assigned to it', 'problem',
    (select count(*) from public.quote_requests q
      where q.scheduled_date is not null and q.assigned_to is null
        and q.status = 'scheduled' and not q.is_test)
  union all select 'Scheduling', 'S6', 'Assigned to somebody no longer active', 'problem',
    (select count(*) from public.quote_requests q
      join public.staff s on s.id = q.assigned_to
     where not s.active and q.status not in ('completed','paid','lost')
       and not q.is_test and q.archived_at is null)

  -- ── MESSAGING ────────────────────────────────────────────────────────────
  union all select 'Messaging', 'X1', 'Texts due but still sitting in the queue', 'problem',
    (select count(*) from public.quote_messages m
      where m.send_after is not null and m.sent_at is null and m.cancelled_at is null
        and m.send_after < now() - interval '2 hours')
  union all select 'Messaging', 'X2', 'Queued with no number or nothing to say', 'problem',
    (select count(*) from public.quote_messages m
      where m.send_after is not null and m.sent_at is null and m.cancelled_at is null
        and (m.to_phone is null or m.body is null))
  union all select 'Messaging', 'X3', 'Texts that failed in the last 30 days', 'review',
    (select count(*) from public.quote_messages m
      where not m.ok and m.send_after is null and m.created_at > now() - interval '30 days')
  union all select 'Messaging', 'X4', 'Quote sent, but no quote text was ever logged', 'review',
    (select count(*) from public.quote_requests q
      where q.quote_sent_at is not null and not q.is_test and q.archived_at is null
        and not exists (select 1 from public.quote_messages m
                         where m.quote_id = q.id and m.kind in ('quote_ready','quote_updated')))

  -- ── LINE ITEMS ───────────────────────────────────────────────────────────
  union all select 'Line items', 'L1', 'Line items do not add up to the job price', 'problem',
    (select count(*) from (
        select q.id from public.quote_requests q
          join public.quote_options o on o.quote_id = q.id
         where q.customer_response = 'accepted' and not q.is_test and q.archived_at is null
         group by q.id, q.quote_amount
        having round(sum(case when o.required or o.customer_response = 'accepted' then o.amount else 0 end) * 100)
             <> round(coalesce(q.quote_amount,0) * 100)) x)
  union all select 'Line items', 'L2', 'Customer approved without answering every option', 'review',
    (select count(*) from public.quote_options o
      join public.quote_requests q on q.id = o.quote_id
     where q.customer_response = 'accepted' and not o.required and o.customer_response is null
       and not q.is_test and q.archived_at is null)

  -- ── PEOPLE ───────────────────────────────────────────────────────────────
  union all select 'People', 'H1', 'Active crew with no phone number', 'problem',
    (select count(*) from public.staff s
      where s.active and s.role = 'contractor' and coalesce(trim(s.phone), '') = '')
  union all select 'People', 'H2', 'Crew holding live jobs but unable to take a card', 'review',
    (select count(*) from public.staff s
      where s.active and s.role = 'contractor' and not s.stripe_charges_enabled
        and exists (select 1 from public.quote_requests q
                     where q.assigned_to = s.id and q.customer_response = 'accepted'
                       and q.status not in ('paid','lost') and not q.is_test))
  union all select 'People', 'H3', 'Nobody is set up as an owner', 'problem',
    (select case when exists (select 1 from public.staff s where s.active and s.role = 'owner')
            then 0 else 1 end)

  -- ── INTEGRITY ────────────────────────────────────────────────────────────
  union all select 'Integrity', 'I1', 'Two leads sharing a customer link', 'problem',
    (select count(*) from (
        select public_token from public.quote_requests
         where public_token is not null group by public_token having count(*) > 1) d)
  union all select 'Integrity', 'I2', 'Two leads sharing a crew link', 'problem',
    (select count(*) from (
        select job_token from public.quote_requests
         where job_token is not null group by job_token having count(*) > 1) d)
  union all select 'Integrity', 'I3', 'Leads with no link at all', 'problem',
    (select count(*) from public.quote_requests q
      where q.public_token is null or q.job_token is null)
  union all select 'Integrity', 'I4', 'Leads with no phone number', 'review',
    (select count(*) from public.quote_requests q
      where coalesce(trim(q.phone), '') = '' and not q.is_test and q.archived_at is null)

  -- ── CONTEXT ──────────────────────────────────────────────────────────────
  union all select 'Context', 'C1', 'Test leads (excluded from every check above)', 'info',
    (select count(*) from public.quote_requests q where q.is_test)
  union all select 'Context', 'C2', 'Archived leads', 'info',
    (select count(*) from public.quote_requests q where q.archived_at is not null)
  union all select 'Context', 'C3', 'Live leads in the pipeline', 'info',
    (select count(*) from public.quote_requests q
      where q.archived_at is null and not q.is_test and q.status not in ('paid','lost'))
  union all select 'Context', 'C4', 'Customers who have paid something', 'info',
    (select count(distinct p.quote_id) from public.quote_payments p
      join public.quote_requests q on q.id = p.quote_id
     where p.status in ('paid','refunded') and not q.is_test)
  union all select 'Context', 'C5', 'Texts still waiting for the morning', 'info',
    (select count(*) from public.quote_messages m
      where m.send_after is not null and m.sent_at is null and m.cancelled_at is null
        and m.send_after >= now())
)
select
  case when kind = 'info' then 'info'
       when n = 0 then 'ok'
       when kind = 'problem' then 'PROBLEM'
       else 'review' end as status,
  area, ref, check_name, n
from checks
-- Problems first, then anything to review, then the clean ones, context last.
order by
  case when kind = 'info' then 3
       when n = 0 then 2
       when kind = 'problem' then 0
       else 1 end,
  n desc, area, ref;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 2 - THE MONEY PAGE'S FOUR FIGURES, WORKED OUT INDEPENDENTLY
-- ═══════════════════════════════════════════════════════════════════════════
-- The app computes these in TypeScript from the same rows. If these four do
-- not match what /crm/money shows, one of the two is wrong and it is worth
-- knowing which before anybody makes a decision on the number.
--
-- Same rules the app follows: test leads out; money collected on a job that
-- later went to Lost still counts as collected; the balance of a job that is
-- over is nobody's to chase; the fee is the frozen RATE against today's price,
-- and is earned only as far as the customer has actually paid.
with job as (
  select
    q.id,
    q.status,
    q.assigned_to,
    -- Exactly the app's rule, archiving included: moneyBoard asks for accepted
    -- and not lost, and says nothing about archived_at. Adding a condition here
    -- that the app does not apply would make these four figures disagree with
    -- the page for a reason that has nothing to do with the data.
    (q.customer_response = 'accepted' and q.status <> 'lost') as on_books,
    round(coalesce(q.quote_amount, 0) * 100)::bigint as total_cents,
    round(coalesce(q.quote_amount, 0) * 100 * coalesce(q.fee_rate, 0))::bigint as fee_total_cents,
    coalesce((select sum(p.amount_cents - p.refunded_cents) from public.quote_payments p
               where p.quote_id = q.id and p.status in ('paid','refunded')), 0)::bigint as paid_cents,
    coalesce((select sum(p.fee_cents) from public.quote_payments p
               where p.quote_id = q.id and p.status in ('paid','refunded')), 0)::bigint as fee_taken_cents
  from public.quote_requests q
  where not q.is_test
    and (q.customer_response = 'accepted' or exists (
          select 1 from public.quote_payments p where p.quote_id = q.id and p.status in ('paid','refunded')))
),
settled as (
  select coalesce(sum(s.amount_cents), 0)::bigint as cents
  from public.fee_settlements s
  where not exists (select 1 from public.quote_requests q where q.id = s.quote_id and q.is_test)
)
select
  '$' || to_char(sum(j.paid_cents) / 100.0, 'FM999,999,990.00') as collected_from_customers,
  '$' || to_char(sum(case when j.on_books then greatest(j.total_cents - j.paid_cents, 0) else 0 end) / 100.0,
                 'FM999,999,990.00') as customers_still_owe,
  '$' || to_char((sum(j.fee_taken_cents) + (select cents from settled)) / 100.0,
                 'FM999,999,990.00') as your_fees_received,
  '$' || to_char(greatest(
           sum(least(j.fee_total_cents, j.paid_cents)) - sum(j.fee_taken_cents) - (select cents from settled), 0
         ) / 100.0, 'FM999,999,990.00') as your_fees_still_owed
from job j;


-- ═══════════════════════════════════════════════════════════════════════════
-- PART 3 - DRILL-DOWNS
-- ═══════════════════════════════════════════════════════════════════════════
-- Highlight one block and run it. They are keyed to the `ref` column above.

-- M1 - marked paid, no payment recorded
select q.id, q.name, q.status, q.quote_amount, q.paid_at, s.full_name as contractor
from public.quote_requests q left join public.staff s on s.id = q.assigned_to
where q.customer_response = 'accepted' and q.status <> 'lost' and not q.is_test
  and (q.status = 'paid' or q.paid_at is not null)
  and not exists (select 1 from public.quote_payments p where p.quote_id = q.id and p.status in ('paid','refunded'))
order by q.paid_at desc nulls last;

-- M3 - payments against a job that left the pipeline
select q.id, q.name, q.status, q.customer_response, q.archived_at,
       sum(p.amount_cents - p.refunded_cents) as collected_cents, count(*) as rows
from public.quote_requests q join public.quote_payments p on p.quote_id = q.id
where p.status in ('paid','refunded') and not q.is_test
  and (q.customer_response is distinct from 'accepted' or q.status = 'lost' or q.archived_at is not null)
group by q.id, q.name, q.status, q.customer_response, q.archived_at
order by 6 desc;

-- M6 - collected more than the job is worth
select q.id, q.name, q.quote_amount, sum(p.amount_cents - p.refunded_cents) as collected_cents, count(*) as rows
from public.quote_requests q join public.quote_payments p on p.quote_id = q.id and p.status in ('paid','refunded')
where q.customer_response = 'accepted' and q.status <> 'lost' and not q.is_test
group by q.id, q.name, q.quote_amount
having sum(p.amount_cents - p.refunded_cents) > round(coalesce(q.quote_amount,0) * 100)
order by 4 desc;

-- P1 / P2 / P3 / P4 - jobs whose status disagrees with what is on them
select q.id, q.name, q.status, q.quote_amount, q.quote_sent_at, q.customer_response, q.scheduled_date,
       case
         when q.status = 'scheduled' and q.scheduled_date is null then 'scheduled with no work day'
         when q.status = 'quoted' and coalesce(q.quote_amount,0) <= 0 then 'quoted with no price'
         when q.status = 'quoted' and q.quote_sent_at is null then 'quoted but never sent'
         when q.customer_response = 'accepted' and q.status in ('new','quoted') then 'accepted but never moved on'
       end as problem
from public.quote_requests q
where not q.is_test and q.archived_at is null
  and ((q.status = 'scheduled' and q.scheduled_date is null)
    or (q.status = 'quoted' and coalesce(q.quote_amount,0) <= 0)
    or (q.status = 'quoted' and q.quote_sent_at is null)
    or (q.customer_response = 'accepted' and q.status in ('new','quoted')))
order by q.created_at desc;

-- S1 - two jobs booked on the same day
select q.scheduled_date, count(*) as jobs, string_agg(q.name, ', ') as customers
from public.quote_requests q
where q.scheduled_date is not null and q.customer_response = 'accepted'
  and q.status <> 'lost' and not q.is_test
group by q.scheduled_date having count(*) > 1
order by q.scheduled_date desc;

-- S2 - the work day has passed and the job is still open
select q.id, q.name, q.scheduled_date, q.status, s.full_name as contractor
from public.quote_requests q left join public.staff s on s.id = q.assigned_to
where q.status = 'scheduled' and q.scheduled_date < current_date and not q.is_test and q.archived_at is null
order by q.scheduled_date;

-- X1 - texts due but still queued. A number here means the drain is not running.
select m.id, m.quote_id, m.kind, m.role, m.to_phone, m.send_after, m.created_at
from public.quote_messages m
where m.send_after is not null and m.sent_at is null and m.cancelled_at is null
  and m.send_after < now() - interval '2 hours'
order by m.send_after;

-- L1 - line items that do not add up to the price
select q.id, q.name, q.quote_amount,
       sum(case when o.required or o.customer_response = 'accepted' then o.amount else 0 end) as items_total,
       count(*) as items
from public.quote_requests q join public.quote_options o on o.quote_id = q.id
where q.customer_response = 'accepted' and not q.is_test and q.archived_at is null
group by q.id, q.name, q.quote_amount
having round(sum(case when o.required or o.customer_response = 'accepted' then o.amount else 0 end) * 100)
     <> round(coalesce(q.quote_amount,0) * 100)
order by q.created_at desc;

-- H1 / H2 - crew who cannot be reached, or cannot be paid
select s.id, s.full_name, s.email, s.phone, s.active, s.stripe_charges_enabled,
       (select count(*) from public.quote_requests q
         where q.assigned_to = s.id and q.status not in ('completed','paid','lost') and not q.is_test) as live_jobs
from public.staff s
where s.active and s.role = 'contractor'
order by s.full_name;

-- I4 - leads nobody can call back
select q.id, q.name, q.email, q.phone, q.status, q.created_at
from public.quote_requests q
where coalesce(trim(q.phone), '') = '' and not q.is_test and q.archived_at is null
order by q.created_at desc;
