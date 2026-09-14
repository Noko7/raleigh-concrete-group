-- Raleigh Concrete Group - look at the held-text backlog BEFORE it drains
-- Run in Supabase SQL Editor. Part 1 is read-only. Part 2 writes, and is
-- commented out on purpose.
--
-- WHY THIS EXISTS. A queue that has stopped draining does not lose anything -
-- it accumulates. Every customer text raised during quiet hours since the drain
-- broke is still sitting in quote_messages, due, waiting for something to pick
-- it up. The moment the drain works again, all of it goes out.
--
-- That is right for this morning's quotes and wrong for a week-old one. A
-- customer who is already booked does not need last Tuesday's "your quote is
-- ready", and a reminder for a job that has since been done reads as chaos. So
-- look at the backlog first, retire what is stale, and let the rest fly.
--
-- Note the ordinary Cancel button cannot do this: it only offers itself on a
-- text whose hour has NOT come round yet, because cancelling a text the drain
-- may already be holding is a race. Everything here is past due, so it is a
-- deliberate SQL job rather than a button.

-- ── PART 1: what is actually queued ────────────────────────────────────────
-- One row per waiting text, oldest first. `hours_late` is how long past its
-- promised hour it has been sitting.
select
  m.id,
  m.kind,
  m.role,
  m.to_phone,
  q.name as customer,
  q.status as job_status,
  m.send_after,
  round(extract(epoch from (now() - m.send_after)) / 3600.0, 1) as hours_late,
  left(coalesce(m.body, ''), 80) as starts_with
from public.quote_messages m
left join public.quote_requests q on q.id = m.quote_id
where m.send_after is not null and m.sent_at is null and m.cancelled_at is null
order by m.send_after;

-- The same thing counted, for a quick sense of scale.
select
  count(*) filter (where m.send_after <= now())                            as due_now,
  count(*) filter (where m.send_after >  now())                            as not_due_yet,
  count(*) filter (where m.send_after <= now() - interval '24 hours')      as over_a_day_late,
  min(m.send_after)                                                        as oldest
from public.quote_messages m
where m.send_after is not null and m.sent_at is null and m.cancelled_at is null;

-- ── PART 2: retire the stale ones ──────────────────────────────────────────
-- UNCOMMENT AND EDIT THE INTERVAL, then run. Marks anything older than the cut
-- as cancelled so the next drain skips it. The rows stay: the message log is
-- the record of what this job told people, and a text we decided not to send a
-- week late is part of that record.
--
-- Read PART 1 first and pick the interval from what is actually in there. The
-- 24 hours below is a starting point, not a recommendation.
--
-- update public.quote_messages
-- set cancelled_at = now(),
--     detail = coalesce(detail, '') || ' Retired unsent: the queue had stalled and this was too old to send.'
-- where send_after is not null
--   and sent_at is null
--   and cancelled_at is null
--   and send_after < now() - interval '24 hours';
