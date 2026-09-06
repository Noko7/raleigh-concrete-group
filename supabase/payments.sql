-- Raleigh Concrete Group - the payment ledger
-- Run this AFTER crm.sql and appointments.sql, once, in Supabase → SQL Editor.
-- Safe to re-run.
--
-- Until now "paid" was a single timestamp somebody set by hand after a Zelle
-- landed. That cannot answer the questions the business actually has: how much
-- of this job has been collected, by what means, and what does the contractor
-- still owe the office?
--
-- A job now has a TOTAL and a list of PAYMENTS. "Deposit" stops being a column
-- and becomes simply the first payment, which is what lets one job carry
-- $4,000 in cash and $6,000 on a card without a schema change. Three
-- instalments, an overpayment and a half-refunded cancellation all fall out of
-- the same shape.
--
-- The money only ever moves one way. The customer pays the CONTRACTOR - their
-- Stripe account is the merchant of record, so their card fees and their
-- 1099-K - and the contractor pays the office its percentage out of that. The
-- office never holds the customer's money and never owes a contractor
-- anything, which is the whole reason this is worth the trouble.

-- ── 1. The contractor's Stripe account ──────────────────────────────────────
-- Created in the Stripe Dashboard and onboarded by the contractor themselves;
-- the office pastes the resulting acct_… here. The three flags are Stripe's
-- answer to "can this person actually be paid", refreshed from the API and
-- kept current by the account.updated webhook. They are cached rather than
-- asked live because every screen that offers a payment button needs to know,
-- and none of them should wait on a round-trip to Stripe to render.
alter table public.staff add column if not exists stripe_account_id       text;
alter table public.staff add column if not exists stripe_charges_enabled  boolean not null default false;
alter table public.staff add column if not exists stripe_payouts_enabled  boolean not null default false;
alter table public.staff add column if not exists stripe_details_submitted boolean not null default false;
alter table public.staff add column if not exists stripe_checked_at       timestamptz;

-- One Stripe account per contractor, and never the same one on two people:
-- two contractors sharing an acct_ would each be taking the other's money.
create unique index if not exists staff_stripe_account_idx
  on public.staff(stripe_account_id)
  where stripe_account_id is not null;

-- ── 2. The office's cut, frozen onto the job ────────────────────────────────
-- The rate is 15% for a contractor's first three paid jobs and 10% after, but
-- it is written onto the JOB the first time money moves and never recalculated.
-- A contractor crossing the threshold mid-job must not silently reprice work
-- that was already quoted and agreed.
--
-- fee_total_cents is what the office has EARNED on this job. What it has
-- actually COLLECTED is the sum of fee_cents on the paid rows below, and the
-- difference is what the contractor still owes. That subtraction is the whole
-- cash board.
alter table public.quote_requests add column if not exists fee_rate       numeric(5, 4);
alter table public.quote_requests add column if not exists fee_total_cents integer;

-- ── 3. The ledger ───────────────────────────────────────────────────────────
create table if not exists public.quote_payments (
  id         uuid primary key default gen_random_uuid(),
  quote_id   uuid not null references public.quote_requests(id) on delete cascade,

  -- How the customer paid. 'card' is the only one that moves through Stripe;
  -- the rest are the crew telling us what landed in their hand or their phone.
  method     text not null,

  -- Cents throughout, never a float. Money in this table is compared, summed
  -- and handed to Stripe, and Stripe counts in cents - carrying dollars as
  -- numeric here would mean converting at every boundary and rounding at some
  -- of them.
  amount_cents integer not null,

  -- The office's cut taken out of THIS payment. Only ever non-zero on a card
  -- payment, where Stripe moves it automatically as the application fee. A
  -- recorded cash payment collects nothing, which is exactly why the debt on
  -- the job survives it.
  fee_cents  integer not null default 0,

  status     text not null default 'pending',

  -- Stripe's side. Null on anything the crew recorded by hand.
  --
  -- stripe_account_id is stored per PAYMENT rather than read from the
  -- contractor when needed: a job can be reassigned after money has moved, and
  -- the record has to keep saying whose account actually received it.
  stripe_account_id   text,
  checkout_session_id text,
  payment_intent_id   text,

  refunded_cents integer not null default 0,

  -- Who keyed it in. Null means nobody did - the customer paid it themselves
  -- through Stripe and the webhook wrote the row.
  recorded_by uuid references public.staff(id) on delete set null,
  note        text,

  created_at  timestamptz not null default now(),
  paid_at     timestamptz,
  refunded_at timestamptz
);

alter table public.quote_payments drop constraint if exists qp_chk;
alter table public.quote_payments add constraint qp_chk check (
  method in ('card', 'cash', 'venmo', 'zelle', 'check', 'other')
  and status in ('pending', 'paid', 'failed', 'refunded')
  -- A zero-dollar payment is a mis-tap, and a negative one is a refund wearing
  -- a disguise. Refunds are recorded on the row they reverse.
  and amount_cents > 0
  and amount_cents <= 100000000
  and fee_cents >= 0
  -- Stripe's own rule for an application fee, enforced here too so a bad
  -- calculation is caught by the database rather than by a customer's failed
  -- checkout: the fee is always strictly smaller than the payment carrying it.
  and fee_cents < amount_cents
  and refunded_cents >= 0
  and refunded_cents <= amount_cents
  and (note is null or char_length(note) <= 500)
);

-- The ledger is always read per job, newest first.
create index if not exists qp_quote_idx on public.quote_payments(quote_id, created_at desc);
-- The cash board reads it the other way: everything paid in a date range,
-- across every job, grouped by contractor.
create index if not exists qp_paid_idx on public.quote_payments(paid_at desc) where status = 'paid';
create index if not exists qp_account_idx on public.quote_payments(stripe_account_id);

-- Stripe delivers a webhook more than once, by design. This is what makes that
-- harmless: the second delivery for a session collides here instead of adding
-- a second payment to the job.
create unique index if not exists qp_session_idx
  on public.quote_payments(checkout_session_id)
  where checkout_session_id is not null;

-- ── 4. RLS - scoped exactly like the job it belongs to ──────────────────────
-- Owners see every payment. A contractor sees the payments on jobs assigned to
-- them, which is what lets the crew record cash from their own job page.
--
-- One policy per command rather than one FOR ALL: insert has no existing row
-- to test with USING, and folding them together is how an insert policy
-- quietly ends up checking nothing.
alter table public.quote_payments enable row level security;
grant select, insert, update on public.quote_payments to authenticated;
grant all on public.quote_payments to service_role;

-- Deliberately no delete grant. A payment that turns out to be wrong is
-- refunded or corrected, never erased: the ledger is the record the office and
-- the contractor settle up from, and a row vanishing out of it is the one
-- thing that would make it untrustworthy.

drop policy if exists "staff read payments" on public.quote_payments;
create policy "staff read payments" on public.quote_payments
  for select to authenticated
  using (
    public.is_owner()
    or exists (
      select 1 from public.quote_requests q
      where q.id = quote_payments.quote_id and q.assigned_to = auth.uid()
    )
  );

drop policy if exists "staff insert payments" on public.quote_payments;
create policy "staff insert payments" on public.quote_payments
  for insert to authenticated
  with check (
    public.is_owner()
    or exists (
      select 1 from public.quote_requests q
      where q.id = quote_payments.quote_id and q.assigned_to = auth.uid()
    )
  );

drop policy if exists "staff update payments" on public.quote_payments;
create policy "staff update payments" on public.quote_payments
  for update to authenticated
  using (
    public.is_owner()
    or exists (
      select 1 from public.quote_requests q
      where q.id = quote_payments.quote_id and q.assigned_to = auth.uid()
    )
  )
  with check (
    public.is_owner()
    or exists (
      select 1 from public.quote_requests q
      where q.id = quote_payments.quote_id and q.assigned_to = auth.uid()
    )
  );

-- ── 5. Settling the contractor's debt to the office ─────────────────────────
-- A card payment pays the office automatically, as the Stripe application fee.
-- Cash does not, so the fee stays owed on the job until the contractor sends
-- it over - by Zelle or Venmo, usually - and the office records that here.
--
-- Owner-only, and separate from quote_payments on purpose: these are two
-- different debts moving in two different directions, and a contractor being
-- able to write "I paid the office" would make the board they are settled from
-- worthless.
create table if not exists public.fee_settlements (
  id           uuid primary key default gen_random_uuid(),
  staff_id     uuid not null references public.staff(id) on delete cascade,
  -- Optional: the job this was settling, when it is one job's fee rather than
  -- a contractor clearing several at once.
  quote_id     uuid references public.quote_requests(id) on delete set null,
  amount_cents integer not null,
  method       text not null,
  note         text,
  recorded_by  uuid references public.staff(id) on delete set null,
  created_at   timestamptz not null default now()
);

alter table public.fee_settlements drop constraint if exists fs_chk;
alter table public.fee_settlements add constraint fs_chk check (
  amount_cents > 0
  and amount_cents <= 100000000
  and method in ('cash', 'venmo', 'zelle', 'check', 'card', 'other')
  and (note is null or char_length(note) <= 500)
);

create index if not exists fs_staff_idx on public.fee_settlements(staff_id, created_at desc);

alter table public.fee_settlements enable row level security;
grant select, insert on public.fee_settlements to authenticated;
grant all on public.fee_settlements to service_role;

drop policy if exists "owner read settlements" on public.fee_settlements;
create policy "owner read settlements" on public.fee_settlements
  for select to authenticated using (public.is_owner());

drop policy if exists "owner insert settlements" on public.fee_settlements;
create policy "owner insert settlements" on public.fee_settlements
  for insert to authenticated with check (public.is_owner());
