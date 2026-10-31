-- Card as a way to pay on agreements: a contractor's payment_methods may now include 'card' (five in all).
-- The default for new staff stays the original four; the owner ticks Card per contractor.

set local lock_timeout = '5s';

alter table public.staff drop constraint staff_agreement_fields_chk;
alter table public.staff add constraint staff_agreement_fields_chk CHECK (
  ((license_number IS NULL) OR (char_length(license_number) <= 60))
  AND ((cardinality(payment_methods) >= 1) AND (cardinality(payment_methods) <= 5))
  AND (payment_methods <@ '{zelle,venmo,check,cash,card}'::text[])
);
