-- Raleigh Concrete Group - why the Money page disagrees with reality
-- Run in Supabase → SQL Editor. Sections 1 to 7 only READ. Nothing changes
-- until you get to section 8, and section 8 is opt-in line by line.
--
-- Every figure on the Money page is a sum over rows, so one row in an odd
-- state is a total nobody can justify. This file finds those rows and then,
-- once you have decided what each one should have been, fixes them.
--
-- Run section 0 first. If it comes back all zeros, the page is telling the
-- truth and the problem is somewhere else.

-- ── 0. The scoreboard ───────────────────────────────────────────────────────
-- One row, one number per problem. Anything above zero has a section below it.
select
  (select count(*) from public.quote_requests q
     where q.customer_response = 'accepted' and q.status <> 'lost'
       and (q.status = 'paid' or q.paid_at is not null)
       and not exists (select 1 from public.quote_payments p
                        where p.quote_id = q.id and p.status in ('paid','refunded'))
  ) as paid_but_no_payment_rows,
  (select count(*) from public.quote_requests q
     where q.customer_response = 'accepted' and q.status <> 'lost'
       and coalesce(q.quote_amount, 0) <= 0
  ) as accepted_with_no_price,
  (select count(*) from public.quote_payments p
     where p.status in ('paid','refunded')
       and not exists (select 1 from public.quote_requests q
                        where q.id = p.quote_id
                          and q.customer_response = 'accepted' and q.status <> 'lost')
  ) as payments_on_invisible_jobs,
  (select count(*) from public.quote_requests q
     where q.fee_rate is null
       and exists (select 1 from public.quote_payments p
                    where p.quote_id = q.id and p.status = 'paid')
  ) as paid_jobs_with_no_fee_rate,
  (select count(*) from public.quote_requests q
     where q.fee_rate is not null
       and q.fee_total_cents is distinct from round(coalesce(q.quote_amount,0) * 100 * q.fee_rate)
  ) as stale_fee_stamps;

-- ── 1. Marked paid, never recorded ──────────────────────────────────────────
-- The big one, and almost always the reason "customers still owe" is too high.
-- These jobs were closed out before the app had a payments ledger: they carry
-- a paid_at and a status of Paid, and no payment rows at all, so every penny
-- of them counts as outstanding forever.
select q.id, q.name, q.status, q.quote_amount, q.paid_at, q.completed_at, s.full_name as contractor
from public.quote_requests q
left join public.staff s on s.id = q.assigned_to
where q.customer_response = 'accepted' and q.status <> 'lost'
  and (q.status = 'paid' or q.paid_at is not null)
  and not exists (select 1 from public.quote_payments p
                   where p.quote_id = q.id and p.status in ('paid','refunded'))
order by q.paid_at desc nulls last;

-- How much of "customers still owe" is those rows.
select coalesce(sum(q.quote_amount), 0) as ghost_outstanding_dollars
from public.quote_requests q
where q.customer_response = 'accepted' and q.status <> 'lost'
  and (q.status = 'paid' or q.paid_at is not null)
  and not exists (select 1 from public.quote_payments p
                   where p.quote_id = q.id and p.status in ('paid','refunded'));

-- ── 2. Approved with no price ───────────────────────────────────────────────
-- A customer said yes to a job carrying no figure. It cannot be chased and it
-- earns nothing, so it sits in the counts and contributes to no total.
select q.id, q.name, q.status, q.quote_amount, q.created_at, s.full_name as contractor
from public.quote_requests q
left join public.staff s on s.id = q.assigned_to
where q.customer_response = 'accepted' and q.status <> 'lost'
  and coalesce(q.quote_amount, 0) <= 0
order by q.created_at desc;

-- ── 3. Money against jobs the page cannot see ───────────────────────────────
-- Payments whose job was archived, marked lost, or had its quote retracted.
-- The money is real and in no total on the Money page.
select p.id, p.quote_id, q.name, q.status, q.customer_response, q.archived_at,
       p.method, p.amount_cents, p.paid_at
from public.quote_payments p
left join public.quote_requests q on q.id = p.quote_id
where p.status in ('paid','refunded')
  and (q.id is null or q.customer_response is distinct from 'accepted' or q.status = 'lost')
order by p.paid_at desc nulls last;

-- ── 4. Paid, but the office never set a rate ────────────────────────────────
-- fee_rate is frozen the first time money is about to move. A job that took
-- money without one earns the office nothing, on every screen, forever.
select q.id, q.name, q.quote_amount, q.fee_rate, q.fee_total_cents,
       (select sum(p.amount_cents - p.refunded_cents) from public.quote_payments p
         where p.quote_id = q.id and p.status in ('paid','refunded')) as collected_cents,
       s.full_name as contractor
from public.quote_requests q
left join public.staff s on s.id = q.assigned_to
where q.fee_rate is null
  and exists (select 1 from public.quote_payments p where p.quote_id = q.id and p.status = 'paid')
order by q.created_at desc;

-- ── 5. Fee stamps that no longer match the job ──────────────────────────────
-- fee_total_cents was written when the rate was frozen. If the job was
-- repriced afterwards the stamp is stale. The app now re-derives the fee from
-- fee_rate against the current total and ignores the stamp, so this is
-- housekeeping rather than a live problem - but it is worth seeing how far the
-- two had drifted, because that difference was showing on the page.
select q.id, q.name, q.quote_amount, q.fee_rate,
       q.fee_total_cents as stamped_cents,
       round(coalesce(q.quote_amount,0) * 100 * q.fee_rate) as should_be_cents,
       round(coalesce(q.quote_amount,0) * 100 * q.fee_rate) - coalesce(q.fee_total_cents,0) as drift_cents
from public.quote_requests q
where q.fee_rate is not null
  and q.fee_total_cents is distinct from round(coalesce(q.quote_amount,0) * 100 * q.fee_rate)
order by abs(round(coalesce(q.quote_amount,0) * 100 * q.fee_rate) - coalesce(q.fee_total_cents,0)) desc;

-- ── 6. Collected more than the job is worth ─────────────────────────────────
-- Nearly always the same payment recorded twice: once by the crew on site and
-- once by the webhook, or twice by two people.
select q.id, q.name, q.quote_amount,
       sum(p.amount_cents - p.refunded_cents) as collected_cents,
       count(*) as payment_rows
from public.quote_requests q
join public.quote_payments p on p.quote_id = q.id and p.status in ('paid','refunded')
where q.customer_response = 'accepted' and q.status <> 'lost'
group by q.id, q.name, q.quote_amount
having sum(p.amount_cents - p.refunded_cents) > round(coalesce(q.quote_amount,0) * 100)
order by sum(p.amount_cents - p.refunded_cents) - round(coalesce(q.quote_amount,0) * 100) desc;

-- ── 7. Payments that look like duplicates ───────────────────────────────────
-- Same job, same method, same amount, inside ten minutes of each other.
select p1.quote_id, q.name, p1.method, p1.amount_cents,
       p1.id as first_id, p1.created_at as first_at,
       p2.id as second_id, p2.created_at as second_at
from public.quote_payments p1
join public.quote_payments p2
  on p2.quote_id = p1.quote_id
 and p2.method = p1.method
 and p2.amount_cents = p1.amount_cents
 and p2.id > p1.id
 and p2.created_at between p1.created_at - interval '10 minutes' and p1.created_at + interval '10 minutes'
left join public.quote_requests q on q.id = p1.quote_id
where p1.status in ('paid','refunded') and p2.status in ('paid','refunded')
order by p1.created_at desc;

-- ════════════════════════════════════════════════════════════════════════════
-- 8. FIXES. Nothing below runs until you remove the guard on it.
--
-- Read the section above each one first, decide it is right for YOUR rows, and
-- run them one at a time. Every statement is wrapped so it does nothing until
-- you say so, because a bulk update to money is not something to discover you
-- did not mean.
-- ════════════════════════════════════════════════════════════════════════════

-- 8a. Give the legacy paid jobs a payment row, so history reconciles.
--
-- Records what was actually collected, dated to the day the job was marked
-- paid, method 'other', flagged in the note so it can never be mistaken for a
-- payment this app processed. No fee is charged on these: the office settled
-- them however it settled them at the time, and inventing a cut now would
-- create a debt that was never agreed.
--
-- To run: change `where false` to `where true`.
insert into public.quote_payments (quote_id, method, amount_cents, fee_cents, status, note, paid_at, created_at)
select q.id, 'other', round(q.quote_amount * 100), 0, 'paid',
       'Backfilled from the pre-ledger paid flag. No fee taken.',
       coalesce(q.paid_at, q.completed_at, q.created_at),
       coalesce(q.paid_at, q.completed_at, q.created_at)
from public.quote_requests q
where false  -- <= change to true to apply
  and q.customer_response = 'accepted' and q.status <> 'lost'
  and (q.status = 'paid' or q.paid_at is not null)
  and coalesce(q.quote_amount, 0) > 0
  and not exists (select 1 from public.quote_payments p
                   where p.quote_id = q.id and p.status in ('paid','refunded'));

-- 8b. Re-sync the stale fee stamps to the rate they were frozen at.
-- Cosmetic now that the app derives the fee from fee_rate, but it stops
-- section 5 reporting drift forever.
update public.quote_requests q
set fee_total_cents = round(coalesce(q.quote_amount,0) * 100 * q.fee_rate)
where false  -- <= change to true to apply
  and q.fee_rate is not null
  and q.fee_total_cents is distinct from round(coalesce(q.quote_amount,0) * 100 * q.fee_rate);

-- 8c. One duplicate payment, removed by id.
-- Deliberately NOT a bulk delete: section 7 finds candidates, a person decides
-- which of the pair is the real one, and only then does a row go. Paste the id.
delete from public.quote_payments
where false  -- <= change to true, and put the real id below
  and id = '00000000-0000-0000-0000-000000000000';

-- 8d. A job approved with no price, that should never have been approved.
-- Clearing the response takes it off the Money page without deleting the lead.
update public.quote_requests
set customer_response = null, customer_responded_at = null
where false  -- <= change to true, and list the ids
  and id in ('00000000-0000-0000-0000-000000000000');

-- ── After any fix ───────────────────────────────────────────────────────────
-- Re-run section 0. Every count should be zero, or a number you can explain.
