-- How the customer plans to pay the contractor, picked when they approve the quote (any of the contractor's
-- accepted methods: Zelle, Venmo, Check, Cash, Card). Not a commitment and not money: the ledger stays the record
-- of what was paid. Null on quotes approved before this, or approved while online card payments were on.
--
-- Written only by the server (service role) from the customer's approval; staff read it with the quote under the
-- existing row policies. No policy or grant changes.

set local lock_timeout = '5s';

alter table public.quote_requests
  add column customer_pay_methods text[],
  add constraint qr_customer_pay_methods_chk check (
    customer_pay_methods is null
    or (cardinality(customer_pay_methods) between 1 and 5
        and customer_pay_methods <@ '{zelle,venmo,check,cash,card}'::text[])
  );
