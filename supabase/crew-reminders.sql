-- Raleigh Concrete Group - appointment time + crew reminder tracking
-- Run this in Supabase → SQL Editor. Safe to re-run, and safe to run even if
-- you already ran scheduled-time.sql (both statements are "if not exists").
--
-- RUN THIS ONE FILE and both columns below exist. If confirming a work day is
-- showing "Could not save that date", it's because scheduled_time is missing.
--
-- scheduled_time  the crew's start time for a booked day, e.g. "9:00 AM".
--                 Text rather than a time column, matching visit_time: it's
--                 display copy, never arithmetic.
--
-- crew_reminders  which countdown texts the crew has already had for this
--                 booking: '3' (three days out), '1' (day before), '0' (the
--                 morning of). An array rather than three timestamp columns so
--                 changing the schedule is a constant in the code, not another
--                 migration. Confirming or moving a date clears it, so the new
--                 date gets its own full run of reminders.

alter table public.quote_requests add column if not exists scheduled_time text;
alter table public.quote_requests add column if not exists crew_reminders text[];
