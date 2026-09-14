-- Raleigh Concrete Group - a held text that fails to send is tried again
-- Run this AFTER cancel-held-text.sql, once, in Supabase SQL Editor. Safe to re-run.
--
-- The queue claims a row before it sends it: sent_at is stamped first, so a
-- crash mid-send leaves a text unsent rather than sent twice. The cost of that
-- choice was that a FAILED send was indistinguishable from a delivered one as
-- far as the queue was concerned - sent_at was set, the row dropped out of the
-- due list, and nothing ever looked at it again. One blip from the SMS provider
-- at the moment the morning drain ran meant that quote never went out, ever,
-- and the only trace was a failed row in a log nobody opens.
--
-- attempts  how many times the queue has handed this row to the provider.
--           A failed send now clears sent_at and puts the row back, until
--           attempts reaches the cap in src/lib/crm/queries.ts, at which point
--           it stays failed and stops being retried.
--
-- Rows that already exist are on 0, which is right: none of them have been
-- tried by the retrying version of the code.

alter table public.quote_messages add column if not exists attempts int not null default 0;
