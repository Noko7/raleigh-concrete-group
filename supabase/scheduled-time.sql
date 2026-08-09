-- Raleigh Concrete Group — appointment time on booked jobs
-- Run this AFTER scheduling.sql, once, in Supabase → SQL Editor. Safe to re-run.
--
-- Jobs were booked to a DAY only, so "your project is confirmed" couldn't tell
-- the customer when to expect the crew. The crew now picks a start time when
-- they confirm the day, and it rides through rescheduling, the confirmation
-- texts and the 2-day reminder.
--
-- Text rather than a time column, matching visit_time: it's display copy
-- ("9:00 AM"), never arithmetic.

alter table public.quote_requests add column if not exists scheduled_time text;
