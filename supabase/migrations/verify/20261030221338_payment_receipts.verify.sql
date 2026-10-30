-- Check 20261030221338_payment_receipts on the real database.
--
-- Run AFTER the migration, as the SQL editor's own role (postgres), the whole file at once. It opens its own
-- transaction and ends in ROLLBACK, so nothing it does is kept: the receipts it issues, their numbers and the
-- counter all go back. It reads one real payment id to issue against; no customer details are read or printed.
-- Output: one row per check; any result containing "(bad)" is a failure.

begin;
create temp table _r (check_name text, result text);
grant all on _r to public;

do $$
declare a public.payment_receipts; b public.payment_receipts; q uuid; p uuid; r text;
begin
  select id, quote_id into p, q from public.quote_payments where status = 'paid' order by created_at limit 1;
  if p is null then
    p := gen_random_uuid(); q := gen_random_uuid();
  end if;

  a := public.issue_payment_receipt(jsonb_build_object('payment_id', p, 'quote_id', q, 'paid_at', now(),
         'amount_cents', 50000, 'method', 'zelle', 'customer_name', 'Verify Customer', 'paid_to_name', 'Verify Contractor',
         'customer_copy_requested', true));
  insert into _r values ('issues with a 32-character token', case when length(a.token) = 32 then 'ok' else 'WRONG TOKEN (bad)' end);

  begin
    b := public.issue_payment_receipt(jsonb_build_object('payment_id', p, 'quote_id', q, 'paid_at', now(),
           'amount_cents', 50000, 'method', 'zelle', 'customer_name', 'X', 'paid_to_name', 'Y', 'customer_copy_requested', false));
    r := 'SECOND LIVE RECEIPT ALLOWED (bad)';
  exception when unique_violation then r := 'refused';
  end;
  insert into _r values ('one live receipt per payment', r);

  begin update public.payment_receipts set amount_cents = 1 where id = a.id; r := 'EDIT ALLOWED (bad)';
  exception when others then r := sqlerrm; end;
  insert into _r values ('cannot edit an issued receipt', r);

  begin delete from public.payment_receipts where id = a.id; r := 'DELETE ALLOWED (bad)';
  exception when others then r := sqlerrm; end;
  insert into _r values ('cannot delete a receipt', r);

  update public.payment_receipts set voided_at = now(), void_reason = 'Verify void' where id = a.id;
  begin update public.payment_receipts set void_reason = 'changed' where id = a.id; r := 'RE-VOID ALLOWED (bad)';
  exception when others then r := sqlerrm; end;
  insert into _r values ('a void is final', r);

  b := public.issue_payment_receipt(jsonb_build_object('payment_id', p, 'quote_id', q, 'paid_at', now(),
         'amount_cents', 40000, 'method', 'zelle', 'customer_name', 'Verify Customer', 'paid_to_name', 'Verify Contractor',
         'customer_copy_requested', false, 'replaces_receipt_id', a.id));
  update public.payment_receipts set replaced_by_receipt_id = b.id where id = a.id;
  insert into _r values ('reissue takes the next number',
                         case when b.receipt_number = a.receipt_number + 1 then 'ok' else 'GAP OR REUSE (bad)' end);
end $$;

set local role anon;
do $$ declare r text; begin
  begin perform count(*) from public.payment_receipts; r := 'ANON CAN READ (bad)'; exception when others then r := 'refused'; end;
  insert into _r values ('anon cannot read receipts', r);
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-4000-8000-0000000000aa"}', true);
do $$ declare r text; n int; begin
  select count(*) into n from public.payment_receipts;
  insert into _r values ('a signed-in stranger sees none', case when n = 0 then 'ok' else n || ' VISIBLE (bad)' end);
  begin perform public.issue_payment_receipt('{}'::jsonb); r := 'STRANGER CAN ISSUE (bad)'; exception when others then r := 'refused'; end;
  insert into _r values ('a signed-in user cannot issue', r);
end $$;
reset role;

set local role service_role;
do $$ declare r text; begin
  begin
    insert into public.payment_receipts (receipt_number, payment_id, quote_id, paid_at, amount_cents, method,
                                         customer_name, paid_to_name, customer_copy_requested)
    values (999999, gen_random_uuid(), gen_random_uuid(), now(), 1, 'cash', 'a', 'b', false);
    r := 'SERVICE ROLE CAN INSERT DIRECTLY (bad)';
  exception when others then r := 'refused';
  end;
  insert into _r values ('only the numbering function inserts', r);
end $$;
reset role;

select * from _r;
rollback;
