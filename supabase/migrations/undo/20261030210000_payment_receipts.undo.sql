-- Undo 20261030210000_payment_receipts.
--
-- Receipts are tax records. This refuses to run once any receipt has been issued: dropping the table would
-- destroy them. Export them first (Money -> Receipts -> Download CSV, or select * from
-- public.payment_receipts), then, only if you are sure, delete the guard block below and run it again.

set local lock_timeout = '5s';

do $$
begin
  if exists (select 1 from public.payment_receipts) then
    raise exception 'receipts have been issued; export them before undoing (see the comment at the top)';
  end if;
end $$;

drop table public.payment_receipts;
drop table public.payment_receipt_counter;
drop function if exists public.issue_payment_receipt(jsonb);
drop function if exists public.guard_payment_receipt();
alter table public.staff drop constraint if exists staff_business_chk;
alter table public.staff drop column if exists business_address;
alter table public.staff drop column if exists business_name;
