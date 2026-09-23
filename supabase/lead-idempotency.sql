-- Raleigh Concrete Group - one lead per filled-in quote form
-- Run once in Supabase -> SQL Editor. Safe to re-run. (Applied to the live
-- database on 23 Sep 2026.)
--
-- The quote form mints a random id when it opens and sends it with every
-- attempt to submit (src/lib/quote-submit.ts). /api/quote stores it here, and
-- the unique index turns a second insert of the same form - a retry after a
-- timeout, a double tap, a flaky connection that sent it twice - into a 409,
-- which the route answers with the lead it already saved.
--
-- That is what makes "press the button again" safe advice on every error the
-- form shows, and so what lets the form fail closed: it never has to guess
-- that a request probably got through and show a success screen on a hunch.
--
-- Nullable: rows from before this, and rows the CRM creates, have none.

alter table public.quote_requests add column if not exists client_submission_id text;

create unique index if not exists qr_client_submission_id_key
  on public.quote_requests (client_submission_id)
  where client_submission_id is not null;
