-- Raleigh Concrete Group - two ways to do the same job
-- Run this AFTER crm.sql and quote-options.sql, once, in Supabase → SQL Editor.
-- Safe to re-run.
--
-- quote-options.sql answered "what else would you like while we're here": a
-- list of things the customer says yes or no to, one at a time, and the total
-- follows. It cannot answer the other question customers ask, which is not
-- "and also" but "or instead":
--
--   "What would it cost in concrete, and what would it cost in asphalt?"
--
-- Those are not two line items. Adding both to one list would have the customer
-- buying a concrete driveway AND an asphalt one on the same patch of ground,
-- and the total would be the sum of two jobs only one of which is happening.
-- Until now the second price got quoted over the phone, or as a second quote on
-- a second link, and whichever one the customer answered was the one the crew
-- found out about.
--
-- A quote may now carry packages: complete, mutually exclusive ways of doing
-- the job. The customer picks exactly one. Line items (quote_options) keep
-- working exactly as they did and apply whichever package is chosen - the
-- tear-out, the extra sidewalk - so the two features compose instead of
-- competing.
--
-- A quote with NO rows in this table behaves exactly as it always has.

create table if not exists public.quote_packages (
  id          uuid primary key default gen_random_uuid(),
  quote_id    uuid not null references public.quote_requests(id) on delete cascade,
  -- What this way of doing it is called, e.g. "Concrete driveway".
  title       text not null,
  -- Why somebody would pick this one over the other. The five quote sections
  -- still cover how the job is run; this is what is specific to this choice.
  description text,
  -- What this way of doing it costs, on its own. Line items are added on top
  -- and are shared across every package, so this is the price of the work
  -- itself and not of the whole quote.
  amount      numeric(10, 2) not null default 0,
  -- The one the contractor would pick if it were their driveway. At most one
  -- per quote - the index below enforces it, because two recommendations is
  -- no recommendation.
  recommended boolean not null default false,
  -- The order the customer reads them in, set by whoever wrote the quote.
  sort_order  int not null default 0,
  -- The customer's answer. Null until they respond; on approval the one they
  -- picked is written 'accepted' and every other package on the quote is
  -- written 'declined', so the row is a record of the choice and not just of
  -- the winner.
  customer_response text,
  responded_at      timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.quote_packages drop constraint if exists qp_chk;
alter table public.quote_packages add constraint qp_chk check (
  char_length(title) between 1 and 120
  and (description is null or char_length(description) <= 2000)
  and amount >= 0 and amount <= 99999999
  and (customer_response is null or customer_response in ('accepted', 'declined'))
);

create index if not exists qp_quote_idx on public.quote_packages(quote_id, sort_order);

-- One recommendation per quote. A partial unique index rather than a check,
-- because the rule is about the other rows on the same quote and a check
-- constraint can only see its own.
create unique index if not exists qp_one_recommended
  on public.quote_packages(quote_id) where recommended;

drop trigger if exists qp_touch_updated_at on public.quote_packages;
create trigger qp_touch_updated_at
  before update on public.quote_packages
  for each row execute function public.touch_updated_at();

alter table public.quote_packages enable row level security;
grant select, insert, update, delete on public.quote_packages to authenticated;
grant all on public.quote_packages to service_role;

-- Same scoping as quote_options, and for the same reason: a contractor writes
-- the quote for the jobs assigned to them, from their own job page, so read and
-- write travel together here rather than being split owner/crew.
--
-- One policy per command instead of one FOR ALL, because insert has no USING
-- row to test against - the row does not exist yet - and folding them together
-- is how an insert policy quietly ends up checking nothing.
drop policy if exists "staff read packages" on public.quote_packages;
create policy "staff read packages" on public.quote_packages
  for select to authenticated
  using (
    public.is_owner()
    or exists (
      select 1 from public.quote_requests q
      where q.id = quote_packages.quote_id and q.assigned_to = auth.uid()
    )
  );

drop policy if exists "staff insert packages" on public.quote_packages;
create policy "staff insert packages" on public.quote_packages
  for insert to authenticated
  with check (
    public.is_owner()
    or exists (
      select 1 from public.quote_requests q
      where q.id = quote_packages.quote_id and q.assigned_to = auth.uid()
    )
  );

drop policy if exists "staff update packages" on public.quote_packages;
create policy "staff update packages" on public.quote_packages
  for update to authenticated
  using (
    public.is_owner()
    or exists (
      select 1 from public.quote_requests q
      where q.id = quote_packages.quote_id and q.assigned_to = auth.uid()
    )
  )
  with check (
    public.is_owner()
    or exists (
      select 1 from public.quote_requests q
      where q.id = quote_packages.quote_id and q.assigned_to = auth.uid()
    )
  );

drop policy if exists "staff delete packages" on public.quote_packages;
create policy "staff delete packages" on public.quote_packages
  for delete to authenticated
  using (
    public.is_owner()
    or exists (
      select 1 from public.quote_requests q
      where q.id = quote_packages.quote_id and q.assigned_to = auth.uid()
    )
  );

-- The customer's own choice is written by the token endpoint with the
-- service-role key (there is no session on /q/<token>), which the grant above
-- already covers. Nothing anonymous ever touches this table directly.
