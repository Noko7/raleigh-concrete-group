-- A second number for the customer: a partner, a parent, anyone the customer wants kept in the loop. Every text
-- that goes to the customer about this job also goes here (src/lib/crm/notify/send.ts). Optional, typed in by
-- the office, stored in E.164 like the numbers the app normalises (+19195550142). Null means no copies.
--
-- Contact details are the office's: the customer's phone and email already can't be changed by a contractor
-- (guard_quote_money_columns). The same goes for this number, which decides who gets the customer's texts. Its
-- own small trigger rather than an edit to that function, so nothing else in the guard is rewritten.
--
-- Read with the quote under the existing row policies. No policy or grant changes on the table.

set local lock_timeout = '5s';

alter table public.quote_requests
  add column cc_phone text,
  add constraint qr_cc_phone_chk check (cc_phone is null or char_length(cc_phone) between 7 and 32);

create or replace function public.guard_quote_cc_phone()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if auth.uid() is null or public.is_owner() then
    return new;
  end if;
  if new.cc_phone is distinct from old.cc_phone then
    raise exception 'the customer''s second number is changed by the office' using errcode = '42501';
  end if;
  return new;
end;
$function$;
revoke all on function public.guard_quote_cc_phone() from public;

create trigger qr_guard_cc_phone before update of cc_phone on public.quote_requests
  for each row execute function public.guard_quote_cc_phone();
