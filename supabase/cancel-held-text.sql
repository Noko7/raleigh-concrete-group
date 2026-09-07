-- Raleigh Concrete Group - call a held text back before it goes out
-- Run this AFTER quiet-hours.sql, once, in Supabase → SQL Editor. Safe to re-run.
--
-- Quiet hours hold a customer text until 8am, and spacing holds a crew text for
-- a few minutes. Both mean the same thing for the person who raised it: there
-- is a window where the text has not gone anywhere yet. Until now that window
-- was one-way - the queue would send it in the morning whatever happened in
-- between, including the customer ringing at 9pm to say theyd changed their
-- mind, or the office realising the quote had the wrong number on it.
--
-- A queued row can now be cancelled. It is not deleted: the message log is the
-- record of what this job told people, and a text somebody stopped is part of
-- that record - "why didnt they get the quote?" is answered by the row saying
-- Cancelled, not by its absence.
--
-- cancelled_at  when a member of staff called it back. Null on everything else,
--               which is every row that exists today.
--
-- So a row is still queued if send_after is not null and BOTH sent_at and
-- cancelled_at are null. Once either is set the queue is done with it.

alter table public.quote_messages add column if not exists cancelled_at timestamptz;

-- The flush query narrows by the same three columns, so the partial index does
-- too. Recreated rather than added alongside: a queued row is a handful of rows
-- against a table that only grows, and two indexes for one query is one too many.
drop index if exists public.qm_due_idx;
create index if not exists qm_due_idx
  on public.quote_messages (send_after)
  where send_after is not null and sent_at is null and cancelled_at is null;

-- No new grant. Staff still only SELECT this table. the cancel is written by the
-- server action with the service-role key, which checks the person can reach the
-- job first. That keeps every write to the message log in one place - the server
-- - rather than opening the log up to UPDATE from the browser to support one button.
