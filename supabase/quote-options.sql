-- Raleigh Concrete Group - quote line items the customer answers one by one
-- Run this AFTER crm.sql, once, in Supabase → SQL Editor. Safe to re-run.
--
-- Until now a quote was one price. That works for "pour this patio" and breaks
-- the moment a customer asks the question they always ask: "what would the
-- sidewalk cost while you're here?" The honest answer is two prices and a
-- choice, which a single quote_amount cannot hold - so it got handled over the
-- phone, off the record, and the crew found out on the day.
--
-- A quote may now carry line items. Each is either part of the base job or an
-- optional extra the customer says yes or no to, and the total is whatever they
-- said yes to. A quote with NO rows in this table behaves exactly as it always
-- has: one price, one accept/decline. Nothing existing changes.

create table if not exists public.quote_options (
  id          uuid primary key default gen_random_uuid(),
  quote_id    uuid not null references public.quote_requests(id) on delete cascade,
  -- What it is, e.g. "Back patio" or "Sidewalk to the driveway".
  title       text not null,
  -- What it includes. The five quote sections still cover the job as a whole;
  -- this is what is specific to this item.
  description text,
  amount      numeric(10, 2) not null default 0,
  -- Part of the base job (the customer cannot drop it) vs an extra they choose.
  -- Without this a customer could decline the driveway and accept the $800
  -- apron extension that only exists because of it.
  required    boolean not null default false,
  -- The order the customer reads them in, set by whoever wrote the quote.
  sort_order  int not null default 0,
  -- The customer's answer to THIS item. Null until they respond. A required
  -- item is written 'accepted' along with the rest when they approve.
  customer_response text,
  responded_at      timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.quote_options drop constraint if exists qo_chk;
alter table public.quote_options add constraint qo_chk check (
  char_length(title) between 1 and 120
  and (description is null or char_length(description) <= 2000)
  and amount >= 0 and amount <= 99999999
  and (customer_response is null or customer_response in ('accepted', 'declined'))
);

create index if not exists qo_quote_idx on public.quote_options(quote_id, sort_order);

drop trigger if exists qo_touch_updated_at on public.quote_options;
create trigger qo_touch_updated_at
  before update on public.quote_options
  for each row execute function public.touch_updated_at();

alter table public.quote_options enable row level security;
grant select, insert, update, delete on public.quote_options to authenticated;
grant all on public.quote_options to service_role;

-- Same scoping as the job itself, and for the same reason: a contractor writes
-- the quote for the jobs assigned to them, from their own job page, so read and
-- write travel together here rather than being split owner/crew.
--
-- One policy per command instead of one FOR ALL, because insert has no USING
-- row to test against - the row does not exist yet - and folding them together
-- is how an insert policy quietly ends up checking nothing.
drop policy if exists "staff read options" on public.quote_options;
create policy "staff read options" on public.quote_options
  for select to authenticated
  using (
    public.is_owner()
    or exists (
      select 1 from public.quote_requests q
      where q.id = quote_options.quote_id and q.assigned_to = auth.uid()
    )
  );

drop policy if exists "staff insert options" on public.quote_options;
create policy "staff insert options" on public.quote_options
  for insert to authenticated
  with check (
    public.is_owner()
    or exists (
      select 1 from public.quote_requests q
      where q.id = quote_options.quote_id and q.assigned_to = auth.uid()
    )
  );

drop policy if exists "staff update options" on public.quote_options;
create policy "staff update options" on public.quote_options
  for update to authenticated
  using (
    public.is_owner()
    or exists (
      select 1 from public.quote_requests q
      where q.id = quote_options.quote_id and q.assigned_to = auth.uid()
    )
  )
  with check (
    public.is_owner()
    or exists (
      select 1 from public.quote_requests q
      where q.id = quote_options.quote_id and q.assigned_to = auth.uid()
    )
  );

drop policy if exists "staff delete options" on public.quote_options;
create policy "staff delete options" on public.quote_options
  for delete to authenticated
  using (
    public.is_owner()
    or exists (
      select 1 from public.quote_requests q
      where q.id = quote_options.quote_id and q.assigned_to = auth.uid()
    )
  );

-- The customer's own answers are written by the token endpoint with the
-- service-role key (there is no session on /q/<token>), which the grant above
-- already covers. Nothing anonymous ever touches this table directly.
