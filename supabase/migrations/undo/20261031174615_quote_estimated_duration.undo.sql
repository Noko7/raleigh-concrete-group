-- Undo 20261031174615_quote_estimated_duration: the estimated_duration column. What contractors wrote there is lost (agreements already drafted keep their
-- own copy of the text). Export first if it matters: select id, estimated_duration from public.quote_requests
-- where estimated_duration is not null;

set local lock_timeout = '5s';

alter table public.quote_requests drop constraint if exists qr_estimated_duration_chk;
alter table public.quote_requests drop column if exists estimated_duration;
