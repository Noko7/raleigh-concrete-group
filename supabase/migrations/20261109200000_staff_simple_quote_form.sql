-- Raleigh Concrete Group - per-contractor "simple quote form"
-- Undo: undo/20261109200000_staff_simple_quote_form.undo.sql. Check: verify/20261109200000_staff_simple_quote_form.verify.sql.
--
-- staff.simple_quote_form: when on, the quote form shows one price and the sections, with the price breakdown folded
-- away alongside extras and A/B prices. Off by default, so new contractors (and owners) get the regular form. Set by an
-- owner on the Contractors page; staff RLS already limits writes to owners ("owner manages staff").
-- Nothing reads it but the two quote forms; stored quotes are untouched.

set local lock_timeout = '5s';

alter table public.staff add column simple_quote_form boolean default false not null;
