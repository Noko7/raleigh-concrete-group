-- Raleigh Concrete Group - quiet hours (no CUSTOMER texts 7pm to 8am Eastern)
-- Run this in Supabase → SQL Editor. Safe to re-run.
--
-- A text to a CUSTOMER raised between 7pm and 8am Eastern isn't sent and isn't
-- dropped: it's held, and it goes out at 8am. (The owner and the crew are on
-- the job and get theirs at any hour - the gate is on the send's role, not the
-- clock alone.) The message log is where it waits, because the log already
-- holds everything a queued text needs - who it's for, what it says, which job
-- it belongs to - and a held message showing up in "Texts sent" as "Waiting
-- until 8:00 AM" is exactly where somebody would look for it.
--
-- send_after   when this may go out. Null on everything sent immediately,
--              which is every row written before today and every row written
--              during the day.
-- sent_at      when the queue actually delivered it. Null while it's waiting.
--
-- So: a row is still queued if send_after is not null and sent_at is null.
-- Old rows have both null and are untouched by any of this.

alter table public.quote_messages add column if not exists send_after timestamptz;
alter table public.quote_messages add column if not exists sent_at timestamptz;

-- The flush query: everything due and not yet delivered, oldest first. Partial,
-- because the queue is a handful of rows against a table that only grows.
create index if not exists qm_due_idx
  on public.quote_messages (send_after)
  where send_after is not null and sent_at is null;
