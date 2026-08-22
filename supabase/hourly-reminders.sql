-- Raleigh Concrete Group — reminder tracking (stale leads, quote visits, follow-ups)
-- Run this in Supabase → SQL Editor. Safe to re-run (every statement is
-- "if not exists").
--
-- Backs the extra jobs in /api/cron/reminders (stale lead nudge, 48h quote
-- follow-up) and /api/cron/visit-reminders (night-before quote visit). Each
-- is a one-shot per row, tracked the same way reminder_sent_at already is: a
-- null timestamp means "not sent yet", set once and never cleared.
--
-- stale_lead_reminded_at    a new lead nobody has quoted or scheduled a visit
--                           for, 12+ hours old. Cleared never - once a lead
--                           moves past status "new" it stops qualifying anyway.
--
-- visit_reminder_sent_at    the customer's night-before reminder for their
--                           in-person quote visit (separate from
--                           reminder_sent_at, which is the 2-day heads-up for a
--                           booked WORK day, not a quote visit).
--
-- visit_crew_reminded_at    the assigned contractor's night-before reminder
--                           for the same quote visit. Separate from
--                           crew_reminders (which counts down a booked work
--                           day) because a quote visit only ever gets one
--                           reminder, the night before - no 3-day or
--                           morning-of stage.
--
-- quote_followup_sent_at    a sent quote nobody has accepted or declined,
--                           48+ hours later.

alter table public.quote_requests add column if not exists stale_lead_reminded_at timestamptz;
alter table public.quote_requests add column if not exists visit_reminder_sent_at timestamptz;
alter table public.quote_requests add column if not exists visit_crew_reminded_at timestamptz;
alter table public.quote_requests add column if not exists quote_followup_sent_at timestamptz;
