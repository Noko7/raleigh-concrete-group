-- Undo customer_cc_phone. The second numbers typed in are lost here, and the texts stop going to them. Export first
-- if needed: select id, cc_phone from public.quote_requests where cc_phone is not null;
-- Deploy the app without the feature first: the current code reads and writes cc_phone.

set local lock_timeout = '5s';

drop trigger if exists qr_guard_cc_phone on public.quote_requests;
drop function if exists public.guard_quote_cc_phone();
alter table public.quote_requests drop constraint if exists qr_cc_phone_chk;
alter table public.quote_requests drop column if exists cc_phone;
