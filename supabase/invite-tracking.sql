-- Raleigh Concrete Group — contractor invite tracking
-- Run this AFTER invites.sql, once, in Supabase → SQL Editor. Safe to re-run.
--
-- Adds the missing middle step. Before this an invite was only "pending" or
-- "used", which can't tell "they never opened the link" from "they opened it and
-- got stuck" - and those need completely different follow-ups from the owner.

alter table public.contractor_invites add column if not exists opened_at timestamptz;

-- How many times the link was opened. A repeated open with no account at the end
-- usually means something on the form is blocking them.
alter table public.contractor_invites add column if not exists open_count integer not null default 0;
