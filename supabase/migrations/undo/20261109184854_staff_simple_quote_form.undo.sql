-- Undo 20261109184854_staff_simple_quote_form: the setting goes, and every quote form shows the regular layout.
-- Deploy the app without the setting first, or its writes fail until then.

set local lock_timeout = '5s';

alter table public.staff drop column if exists simple_quote_form;
