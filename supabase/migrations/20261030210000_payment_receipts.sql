-- Raleigh Concrete Group - a numbered, permanent receipt for every customer payment
-- Undo: undo/20261030210000_payment_receipts.undo.sql. Check: verify/20261030210000_payment_receipts.verify.sql.
--
-- The customer pays the CONTRACTOR (cash, check, Zelle, Venmo, or card on the contractor's own Stripe account);
-- the contractor pays the office its fee separately. A receipt records the first of those: who paid, how much,
-- how, when, and which contractor received it. It is for the contractor's and the owner's books, and a copy
-- can be texted to the customer.
--
--   1. staff.business_name and staff.business_address: what a receipt names as the payee. Filled in by the
--      owner on the Contractors page; a receipt falls back to the contractor's name when they are blank.
--   2. payment_receipts: one row per receipt, a frozen copy of everything printed on it, taken when it was
--      issued. Nothing on a receipt is read live afterwards, so later edits to the job, the customer or the
--      contractor never change a receipt already given. Rows are never deleted and never edited, except to
--      void one (once) and to link it to the receipt that replaced it (once); a trigger enforces that for
--      every role, the service role included.
--        * receipt_number: 1, 2, 3... with no gaps. Taken from payment_receipt_counter inside the same
--          transaction as the insert, so a failed insert never burns a number.
--        * token: the unguessable part of the receipt's link (/r/<token>), like the quote link.
--        * At most one live (unvoided) receipt per payment (partial unique index), so the Stripe webhook and
--          the customer's return page racing each other cannot issue two.
--        * No foreign keys to quote_payments or quote_requests: deleting a job cascades to its payments, and
--          a receipt must outlive that. The ids are kept for lookups, with indexes.
--   3. issue_payment_receipt(jsonb): numbers and inserts one receipt from the snapshot the server built.
--      EXECUTE for service_role only; the app calls it from server code after a payment is saved.
--   4. RLS: the owner reads every receipt; a contractor reads the receipts that name them as paid and those
--      on jobs assigned to them. Nobody writes through the API: no INSERT/UPDATE/DELETE for anon or
--      authenticated. The counter table has no API access at all.

set local lock_timeout = '5s';

-- ── 1. Contractor details for the receipt ───────────────────────────────────
alter table public.staff add column if not exists business_name text;
alter table public.staff add column if not exists business_address text;
alter table public.staff add constraint staff_business_chk
  check ((business_name is null or char_length(business_name) <= 120)
     and (business_address is null or char_length(business_address) <= 300));

-- ── 2. Receipts ─────────────────────────────────────────────────────────────
create table public.payment_receipt_counter (
  id boolean default true not null,
  last_number integer default 0 not null,
  constraint payment_receipt_counter_pkey PRIMARY KEY (id),
  constraint payment_receipt_counter_one_row CHECK (id),
  constraint payment_receipt_counter_chk CHECK (last_number >= 0)
);
insert into public.payment_receipt_counter (id, last_number) values (true, 0);

create table public.payment_receipts (
  id uuid default gen_random_uuid() not null,
  receipt_number integer not null,
  token text default replace((gen_random_uuid())::text, '-'::text, ''::text) not null,
  payment_id uuid not null,
  quote_id uuid not null,
  is_test boolean default false not null,
  issued_at timestamp with time zone default now() not null,
  -- The payment, as recorded.
  paid_at timestamp with time zone not null,
  amount_cents integer not null,
  method text not null,
  payment_note text,
  -- Who paid.
  customer_name text not null,
  customer_phone text,
  customer_email text,
  job_service text,
  job_address text,
  -- Who was paid: the job's contractor (else whoever recorded it), as their details stood at issue.
  paid_to_staff_id uuid,
  paid_to_name text not null,
  paid_to_business_name text,
  paid_to_business_address text,
  paid_to_phone text,
  -- Null on a card payment the customer made themselves.
  recorded_by uuid,
  recorded_by_name text,
  -- The job's money right after this payment.
  job_total_cents integer,
  paid_to_date_cents integer,
  balance_cents integer,
  -- A correction voids a receipt and issues a new one; each points at the other.
  replaces_receipt_id uuid,
  replaced_by_receipt_id uuid,
  voided_at timestamp with time zone,
  void_reason text,
  voided_by uuid,
  -- The "send the customer a receipt" box, and when that text went out (or was queued for 8am in quiet
  -- hours; the message log has its delivery).
  customer_copy_requested boolean not null,
  customer_copy_sent_at timestamp with time zone,
  constraint payment_receipts_pkey PRIMARY KEY (id),
  constraint payment_receipts_number_key UNIQUE (receipt_number),
  constraint payment_receipts_token_key UNIQUE (token),
  constraint payment_receipts_replaces_fkey FOREIGN KEY (replaces_receipt_id) REFERENCES payment_receipts(id),
  constraint payment_receipts_replaced_by_fkey FOREIGN KEY (replaced_by_receipt_id) REFERENCES payment_receipts(id),
  constraint payment_receipts_chk CHECK (
    receipt_number > 0
    and token ~ '^[0-9a-f]{32}$'
    and amount_cents > 0 and amount_cents <= 100000000
    and method = ANY (ARRAY['card'::text, 'cash'::text, 'venmo'::text, 'zelle'::text, 'check'::text, 'other'::text])
    and char_length(customer_name) between 1 and 200
    and char_length(paid_to_name) between 1 and 200
    and (payment_note is null or char_length(payment_note) <= 500)
    and (void_reason is null or char_length(void_reason) between 3 and 300)
    and ((voided_at is null) = (void_reason is null))
  )
);

CREATE UNIQUE INDEX payment_receipts_live_payment_idx ON public.payment_receipts USING btree (payment_id) WHERE (voided_at IS NULL);
CREATE INDEX payment_receipts_quote_idx ON public.payment_receipts USING btree (quote_id, issued_at);
CREATE INDEX payment_receipts_paid_to_idx ON public.payment_receipts USING btree (paid_to_staff_id, issued_at);
CREATE INDEX payment_receipts_issued_idx ON public.payment_receipts USING btree (issued_at);

-- Issued is final. Only three things may ever be written afterwards, each once: the void (voided_at,
-- void_reason, voided_by together), the link to the replacement, and the time the customer's copy went out.
create or replace function public.guard_payment_receipt()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'receipts are permanent and cannot be deleted' using errcode = '42501';
  end if;

  if row(new.id, new.receipt_number, new.token, new.payment_id, new.quote_id, new.is_test, new.issued_at,
         new.paid_at, new.amount_cents, new.method, new.payment_note, new.customer_name, new.customer_phone,
         new.customer_email, new.job_service, new.job_address, new.paid_to_staff_id, new.paid_to_name,
         new.paid_to_business_name, new.paid_to_business_address, new.paid_to_phone, new.recorded_by,
         new.recorded_by_name, new.job_total_cents, new.paid_to_date_cents, new.balance_cents,
         new.replaces_receipt_id, new.customer_copy_requested)
     is distinct from
     row(old.id, old.receipt_number, old.token, old.payment_id, old.quote_id, old.is_test, old.issued_at,
         old.paid_at, old.amount_cents, old.method, old.payment_note, old.customer_name, old.customer_phone,
         old.customer_email, old.job_service, old.job_address, old.paid_to_staff_id, old.paid_to_name,
         old.paid_to_business_name, old.paid_to_business_address, old.paid_to_phone, old.recorded_by,
         old.recorded_by_name, old.job_total_cents, old.paid_to_date_cents, old.balance_cents,
         old.replaces_receipt_id, old.customer_copy_requested) then
    raise exception 'a receipt cannot be changed once issued; void it and issue a new one' using errcode = '42501';
  end if;

  if old.voided_at is not null
     and row(new.voided_at, new.void_reason, new.voided_by) is distinct from row(old.voided_at, old.void_reason, old.voided_by) then
    raise exception 'this receipt is already void' using errcode = '42501';
  end if;
  if old.replaced_by_receipt_id is not null and new.replaced_by_receipt_id is distinct from old.replaced_by_receipt_id then
    raise exception 'this receipt has already been replaced' using errcode = '42501';
  end if;
  if old.customer_copy_sent_at is not null and new.customer_copy_sent_at is distinct from old.customer_copy_sent_at then
    raise exception 'the customer copy time is already recorded' using errcode = '42501';
  end if;

  return new;
end;
$function$;

revoke execute on function public.guard_payment_receipt() from public;

CREATE TRIGGER payment_receipts_guard BEFORE DELETE OR UPDATE ON public.payment_receipts FOR EACH ROW EXECUTE FUNCTION guard_payment_receipt();

-- ── 3. Issuing one ──────────────────────────────────────────────────────────
-- The server builds the snapshot (it already has the ledger maths); this only numbers it and stores it, in one
-- transaction. The counter row lock makes concurrent issues queue for a number instead of sharing one.
create or replace function public.issue_payment_receipt(r jsonb)
returns public.payment_receipts
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  n integer;
  out_row public.payment_receipts;
begin
  update public.payment_receipt_counter set last_number = last_number + 1 where id returning last_number into n;

  insert into public.payment_receipts (
    receipt_number, payment_id, quote_id, is_test, paid_at, amount_cents, method, payment_note,
    customer_name, customer_phone, customer_email, job_service, job_address,
    paid_to_staff_id, paid_to_name, paid_to_business_name, paid_to_business_address, paid_to_phone,
    recorded_by, recorded_by_name, job_total_cents, paid_to_date_cents, balance_cents,
    replaces_receipt_id, customer_copy_requested
  ) values (
    n, (r->>'payment_id')::uuid, (r->>'quote_id')::uuid, coalesce((r->>'is_test')::boolean, false),
    (r->>'paid_at')::timestamptz, (r->>'amount_cents')::integer, r->>'method', nullif(r->>'payment_note', ''),
    r->>'customer_name', nullif(r->>'customer_phone', ''), nullif(r->>'customer_email', ''),
    nullif(r->>'job_service', ''), nullif(r->>'job_address', ''),
    (r->>'paid_to_staff_id')::uuid, r->>'paid_to_name', nullif(r->>'paid_to_business_name', ''),
    nullif(r->>'paid_to_business_address', ''), nullif(r->>'paid_to_phone', ''),
    (r->>'recorded_by')::uuid, nullif(r->>'recorded_by_name', ''),
    (r->>'job_total_cents')::integer, (r->>'paid_to_date_cents')::integer, (r->>'balance_cents')::integer,
    (r->>'replaces_receipt_id')::uuid, coalesce((r->>'customer_copy_requested')::boolean, false)
  )
  returning * into out_row;

  return out_row;
end;
$function$;

revoke execute on function public.issue_payment_receipt(jsonb) from public, anon, authenticated;
grant execute on function public.issue_payment_receipt(jsonb) to service_role;

-- ── 4. Who can read them ────────────────────────────────────────────────────
alter table public.payment_receipt_counter enable row level security;
alter table public.payment_receipts enable row level security;

create policy "staff read receipts" on public.payment_receipts as permissive for select to authenticated
  using ((is_owner() OR (paid_to_staff_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM quote_requests q
  WHERE ((q.id = payment_receipts.quote_id) AND (q.assigned_to = auth.uid()))))));

-- Inserts go through issue_payment_receipt() only (it runs as its owner), so every receipt gets its number
-- from the counter: the service role can read and void, not insert, delete or renumber.
revoke all on public.payment_receipt_counter from anon, authenticated, service_role;
revoke all on public.payment_receipts from anon, authenticated, service_role;
grant select on public.payment_receipts to authenticated;
grant select, update on public.payment_receipts to service_role;
