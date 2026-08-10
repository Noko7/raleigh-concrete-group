-- Per-customer log of every text we send, and whether it actually went out.
--
-- Until now a send was best-effort and silent: `notifyNewQuote(...).catch(() => {})`
-- swallowed the failure so a lead could arrive with nobody being told, and the
-- only trace was a line in the Vercel logs nobody reads. This table is the trace
-- that lives where the job does, so "did the customer get that?" is answerable
-- from the job page instead of by guessing.
--
-- Written only by server code with the service-role key (sends happen from the
-- public /api/quote route, which has no user session), so there is no insert
-- policy for logged-in users - only a read policy matching quote_events.
--
-- Run in Supabase → SQL Editor. Safe to re-run.

create table if not exists public.quote_messages (
  id         uuid primary key default gen_random_uuid(),
  -- Nullable: a send we could not tie to a job is still worth recording.
  quote_id   uuid references public.quote_requests(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- Which notification this was, e.g. 'received', 'quote_ready', 'crew_reminder'.
  kind       text not null,
  -- Who it was aimed at: 'customer', 'owner' or 'crew'.
  role       text not null,
  to_phone   text,
  body       text,
  -- The provider accepted it. Not the same as "it arrived" - carrier delivery
  -- is a separate thing we don't get told about - but it is the line between
  -- "our fault" and "not our fault", which is the question being asked.
  ok         boolean not null default false,
  provider   text,
  status     int,
  detail     text
);

create index if not exists qm_quote_idx on public.quote_messages(quote_id, created_at desc);
create index if not exists qm_phone_idx on public.quote_messages(to_phone);

alter table public.quote_messages enable row level security;
grant select on public.quote_messages to authenticated;
grant all on public.quote_messages to service_role;

-- Same scoping as the activity log: owners see everything, a contractor sees
-- the jobs assigned to them.
drop policy if exists "staff read messages" on public.quote_messages;
create policy "staff read messages" on public.quote_messages
  for select to authenticated
  using (
    public.is_owner()
    or exists (
      select 1 from public.quote_requests q
      where q.id = quote_messages.quote_id and q.assigned_to = auth.uid()
    )
  );
