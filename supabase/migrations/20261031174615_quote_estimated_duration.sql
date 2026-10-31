-- Estimated duration: a sixth quote section ("1-2 days", or "Not applicable"), written by the contractor or owner
-- on the quote form, shown to the customer with the other sections, and carried into the agreement's
-- "Estimated Duration" section. Nullable: quotes written before it simply have none.
--
-- No policy or grant changes: quote_requests is already updatable by the owner and the assigned contractor
-- (row policies), and the column is plain text like the other sections.

set local lock_timeout = '5s';

alter table public.quote_requests
  add column estimated_duration text,
  add constraint qr_estimated_duration_chk check (estimated_duration is null or char_length(estimated_duration) <= 200);
