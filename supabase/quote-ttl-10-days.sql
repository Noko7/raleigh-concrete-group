-- Raleigh Concrete Group - give the quotes already out there the longer clock
-- Run this in Supabase → SQL Editor. Safe to re-run.
--
-- QUOTE_TTL_DAYS went from 7 to 10 because customers were going off to collect
-- other quotes and coming back to a dead link. Changing the constant only fixes
-- the quotes sent from now on: quote_expires_at is a real timestamp, written
-- once at send time, so every quote already sitting in somebody's phone still
-- carries the 7-day date it was stamped with.
--
-- This re-stamps them as though the rule had always been 10 days.
--
-- READ THIS BEFORE RUNNING IT. The rule "10 days from when we sent it" also
-- covers quotes that ran out in the last three days, so this REVIVES them - a
-- link a customer found dead yesterday starts working again. That is almost
-- certainly what you want (it is the reason you asked) but it does change what
-- a customer sees, so it should be a decision rather than a side effect.
--
-- Only touches quotes nobody has answered. An accepted quote never expires in
-- the first place, and a declined one has no business coming back to life.

-- 1. Look first. Every row this would change, and what it would change to.
select
  name,
  quote_amount,
  quote_sent_at,
  quote_expires_at                        as expires_now,
  quote_sent_at + interval '10 days'      as expires_after,
  case
    when quote_expires_at < now() then 'REVIVED - had already expired'
    else 'extended'
  end                                     as effect
from public.quote_requests
where quote_sent_at is not null
  and customer_response is null
  and archived_at is null
  and quote_sent_at + interval '10 days' > now()
  and quote_expires_at is distinct from quote_sent_at + interval '10 days'
order by quote_sent_at desc;

-- 2. Then do it. Same conditions, so it changes exactly the rows listed above.
--
-- The last condition is what keeps this idempotent and keeps it off quotes that
-- are dead under the new rule too: a quote sent three weeks ago stays expired,
-- because moving its date would be inventing a price we no longer stand behind.
update public.quote_requests
set quote_expires_at = quote_sent_at + interval '10 days'
where quote_sent_at is not null
  and customer_response is null
  and archived_at is null
  and quote_sent_at + interval '10 days' > now()
  and quote_expires_at is distinct from quote_sent_at + interval '10 days';
