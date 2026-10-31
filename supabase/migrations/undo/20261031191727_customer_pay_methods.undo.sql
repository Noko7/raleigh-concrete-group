-- Undo customer_pay_methods. The customers' stated choices are lost here (each signing that ticked a box also
-- logged a "payment_choice" event in the job's history). Export first if needed: select id, customer_pay_methods from public.quote_requests
-- where customer_pay_methods is not null;

set local lock_timeout = '5s';

alter table public.quote_requests drop constraint if exists qr_customer_pay_methods_chk;
alter table public.quote_requests drop column if exists customer_pay_methods;
