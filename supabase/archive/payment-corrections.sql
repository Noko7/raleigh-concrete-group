-- Raleigh Concrete Group - correcting a payment somebody keyed in wrong
-- Run this AFTER payments.sql, once, in Supabase -> SQL Editor. Safe to re-run.
--
-- Why this file exists.
--
-- A contractor took a 50% deposit and recorded the whole job as paid. Nothing
-- in the app stopped them, and nothing in the app could fix it afterwards:
--
--   * recordManualPayment and the guard_payment_not_over_total trigger both
--     refuse MORE than is owed. On an untouched job the whole total is owed, so
--     the full figure was allowed. The amount box on the form is even
--     pre-filled with the outstanding balance, so recording the entire job is
--     what happens if you open that form and press save.
--   * least-privilege.sql revoked UPDATE on quote_payments from authenticated,
--     deliberately - a contractor restating a payment they already recorded is
--     exactly the thing that file exists to prevent.
--   * refundJobPayment only handles card payments. Cash never moved through
--     Stripe, so there is nothing to send back; the figure is simply wrong.
--
-- That left the Supabase SQL console as the only remedy (money-audit.sql
-- section 8f), which is not a thing to ask somebody to do to their own books at
-- nine in the evening. Corrections now happen in the CRM, owner only, through
-- the service role - which is why no grant or policy changes here. The server
-- checks the role before it writes, and every correction lands in the activity
-- log with the old and the new figure on it.
--
-- All this file does is make room for one new status.

-- ── 'voided': a payment that should never have been recorded ─────────────────
-- Distinct from 'refunded', and the distinction is the whole reason for it:
--
--   refunded  money really did go back to the customer. It belongs on the
--             ledger, on the day it moved, and it reconciles against a bank
--             statement.
--   voided    no money ever moved. The row is a typo - a duplicate, or a
--             payment recorded against the wrong job - and the honest ledger is
--             the one that does not contain it.
--
-- Nothing in the app had to change to make a voided row stop counting. Every
-- figure in the business is summed over rows whose status is 'paid' or
-- 'refunded' (readLedger in src/lib/crm/fees.ts, moneyBoard in money.ts,
-- paidJobCountFor in payments.ts), so a voided row drops out of all of them at
-- once. It stays in the table, visible, with its note saying why - deleting it
-- would leave the office unable to answer "what happened to that $8,250".
alter table public.quote_payments drop constraint if exists qp_chk;
alter table public.quote_payments add constraint qp_chk check (
  method in ('card', 'cash', 'venmo', 'zelle', 'check', 'other')
  and status in ('pending', 'paid', 'failed', 'refunded', 'voided')
  -- A zero-dollar payment is a mis-tap, and a negative one is a refund wearing
  -- a disguise. Refunds are recorded on the row they reverse.
  and amount_cents > 0
  and amount_cents <= 100000000
  and fee_cents >= 0
  -- Stripe's own rule for an application fee, enforced here too so a bad
  -- calculation is caught by the database rather than by a customer's failed
  -- checkout: the fee is always strictly smaller than the payment carrying it.
  --
  -- It also bounds a correction: lowering a payment below the office's cut
  -- already taken out of it is refused here as well as in the server, which is
  -- why only hand-recorded rows (fee_cents = 0) can be corrected at all.
  and fee_cents < amount_cents
  and refunded_cents >= 0
  and refunded_cents <= amount_cents
  and (note is null or char_length(note) <= 500)
);

-- ── Have a look ─────────────────────────────────────────────────────────────
-- The shape that prompted all this: one hand-recorded payment that settles a
-- job exactly, on work that has not been marked finished. Every one of these is
-- either a genuine payment in advance or a deposit entered as the whole job,
-- and only the person who took it can say which.
select q.id, q.name, q.status, q.quote_amount,
       p.id as payment_id, p.method, p.amount_cents, p.paid_at,
       s.full_name as recorded_by
from public.quote_payments p
join public.quote_requests q on q.id = p.quote_id
left join public.staff s on s.id = p.recorded_by
where p.status = 'paid'
  and p.method <> 'card'
  and not coalesce(q.is_test, false)
  and q.completed_at is null
  and round(coalesce(q.quote_amount, 0) * 100) = p.amount_cents
order by p.paid_at desc nulls last;
