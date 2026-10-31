-- Undo: back to four methods. Refuses while any contractor has Card ticked (untick it first in Contractors).

set local lock_timeout = '5s';

do $$
begin
  if exists (select 1 from public.staff where 'card' = any(payment_methods)) then
    raise exception 'a contractor still has Card ticked; untick it first';
  end if;
end $$;

alter table public.staff drop constraint staff_agreement_fields_chk;
alter table public.staff add constraint staff_agreement_fields_chk CHECK (
  ((license_number IS NULL) OR (char_length(license_number) <= 60))
  AND ((cardinality(payment_methods) >= 1) AND (cardinality(payment_methods) <= 4))
  AND (payment_methods <@ '{zelle,venmo,check,cash}'::text[])
);
