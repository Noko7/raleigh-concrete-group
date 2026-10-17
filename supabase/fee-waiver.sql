-- Raleigh Concrete Group - the owner can waive part of the office fee on a job
--
-- The fee is the rate on the whole job total. Sometimes part of that total is
-- not the office's to take a cut of - a change order that only passed through
-- material costs, say - and the owner needs to take that slice off by hand.
--
--   fee_waived_cents   cents taken off this job's office fee. 0 = none.
--   fee_waived_note    why, for the audit trail.
--
-- Owner only: guard_quote_money_columns refuses the change from anybody else,
-- the same way it protects fee_rate and fee_total_cents. Safe to re-run.

alter table public.quote_requests
  add column if not exists fee_waived_cents integer not null default 0,
  add column if not exists fee_waived_note text;

alter table public.quote_requests drop constraint if exists quote_requests_fee_waived_sane;
alter table public.quote_requests add constraint quote_requests_fee_waived_sane check (
  fee_waived_cents >= 0 and fee_waived_cents <= 9999999999
);

create or replace function public.guard_quote_money_columns()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  -- Service role (server code) and owners write freely.
  if auth.uid() is null or public.is_owner() then
    return new;
  end if;

  if new.fee_rate is distinct from old.fee_rate
     or new.fee_total_cents is distinct from old.fee_total_cents
     or new.fee_waived_cents is distinct from old.fee_waived_cents
     or new.fee_waived_note is distinct from old.fee_waived_note then
    raise exception 'the office fee is set by the office'
      using errcode = '42501';
  end if;

  if new.is_test is distinct from old.is_test then
    raise exception 'is_test is set by the office' using errcode = '42501';
  end if;

  if new.archived_at is distinct from old.archived_at then
    raise exception 'archiving a lead is done by the office' using errcode = '42501';
  end if;

  return new;
end;
$function$;
