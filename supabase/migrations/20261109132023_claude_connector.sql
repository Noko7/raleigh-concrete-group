-- Raleigh Concrete Group - the Claude connector (MCP server at /api/mcp with its own OAuth 2.1 sign-in)
-- Undo: undo/20261109132023_claude_connector.undo.sql. Check: verify/20261109132023_claude_connector.verify.sql.
--
-- An owner connects Claude to the CRM from claude.ai (or Claude Code): Claude registers itself, the owner approves
-- on /crm/connect, and Claude gets short-lived, read-only tokens. Switched on and watched from the Security page.
--
--   1. mcp_clients: apps that registered (only Claude's own callback addresses are accepted, in the app).
--   2. mcp_auth_codes: one-minute, single-use approval codes, bound to PKCE.
--   3. mcp_grants: a connection - one owner, one app, read-only, 90 days at most, revocable.
--   4. mcp_tokens: access (1 hour) and refresh (30 days, single use) tokens. Only SHA-256 hashes are stored.
--   5. mcp_activity: every call and every sign-in event, for the Security page. Kept 90 days.
--
-- Expired codes and tokens and old activity are cleared by the app's daily cron (/api/cron/reminders,
-- purgeConnectorRecords), not a database function: this migration deletes nothing.
--
-- All server only: RLS on with no policies, nothing granted to anon or authenticated. The app reads and writes
-- them with the service role after checking the caller.

set local lock_timeout = '5s';

-- ── 1. Registered apps ──────────────────────────────────────────────────────
create table public.mcp_clients (
  client_id text not null,
  client_name text not null,
  redirect_uris text[] not null,
  auth_method text default 'none'::text not null,
  secret_hash text,
  created_at timestamp with time zone default now() not null,
  created_ip text,
  constraint mcp_clients_pkey PRIMARY KEY (client_id),
  constraint mcp_clients_chk CHECK (
    char_length(client_id) <= 100 and char_length(client_name) between 1 and 80
    and cardinality(redirect_uris) between 1 and 5
    and auth_method = any (array['none'::text, 'client_secret_post'::text, 'client_secret_basic'::text])
    and ((auth_method = 'none') = (secret_hash is null))
    and (secret_hash is null or char_length(secret_hash) = 64)
    and (created_ip is null or char_length(created_ip) <= 64)
  )
);

-- ── 2. Approval codes ───────────────────────────────────────────────────────
create table public.mcp_auth_codes (
  code_hash text not null,
  client_id text not null,
  staff_id uuid not null,
  redirect_uri text not null,
  code_challenge text not null,
  scope text not null,
  expires_at timestamp with time zone not null,
  used_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  constraint mcp_auth_codes_pkey PRIMARY KEY (code_hash),
  constraint mcp_auth_codes_client_fkey FOREIGN KEY (client_id) REFERENCES mcp_clients(client_id) ON DELETE CASCADE,
  constraint mcp_auth_codes_staff_fkey FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE,
  constraint mcp_auth_codes_chk CHECK (
    char_length(code_hash) = 64 and char_length(redirect_uri) <= 300 and char_length(code_challenge) = 43
    and scope = 'crm.read'
  )
);

-- ── 3. Connections ──────────────────────────────────────────────────────────
create table public.mcp_grants (
  id uuid default gen_random_uuid() not null,
  client_id text not null,
  client_name text not null,
  staff_id uuid not null,
  scope text not null,
  created_at timestamp with time zone default now() not null,
  expires_at timestamp with time zone not null,
  last_used_at timestamp with time zone,
  last_ip text,
  revoked_at timestamp with time zone,
  revoked_reason text,
  constraint mcp_grants_pkey PRIMARY KEY (id),
  constraint mcp_grants_client_fkey FOREIGN KEY (client_id) REFERENCES mcp_clients(client_id) ON DELETE CASCADE,
  constraint mcp_grants_staff_fkey FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE,
  constraint mcp_grants_chk CHECK (
    scope = 'crm.read' and char_length(client_name) between 1 and 80
    and expires_at <= created_at + interval '90 days 1 minute'
    and (last_ip is null or char_length(last_ip) <= 64)
    and (revoked_reason is null or char_length(revoked_reason) <= 120)
  )
);
create index mcp_grants_live_idx on public.mcp_grants using btree (created_at desc) where revoked_at is null;

-- ── 4. Tokens ───────────────────────────────────────────────────────────────
create table public.mcp_tokens (
  token_hash text not null,
  kind text not null,
  grant_id uuid not null,
  expires_at timestamp with time zone not null,
  used_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  constraint mcp_tokens_pkey PRIMARY KEY (token_hash),
  constraint mcp_tokens_grant_fkey FOREIGN KEY (grant_id) REFERENCES mcp_grants(id) ON DELETE CASCADE,
  constraint mcp_tokens_chk CHECK (
    char_length(token_hash) = 64 and kind = any (array['access'::text, 'refresh'::text])
    and expires_at <= created_at + interval '30 days 1 minute'
  )
);
create index mcp_tokens_grant_idx on public.mcp_tokens using btree (grant_id);

-- ── 5. Activity ─────────────────────────────────────────────────────────────
create table public.mcp_activity (
  id bigint generated always as identity,
  at timestamp with time zone default now() not null,
  kind text not null,
  ok boolean not null,
  grant_id uuid,
  staff_id uuid,
  client_name text,
  tool text,
  detail text,
  ip text,
  ua text,
  constraint mcp_activity_pkey PRIMARY KEY (id),
  constraint mcp_activity_grant_fkey FOREIGN KEY (grant_id) REFERENCES mcp_grants(id) ON DELETE SET NULL,
  constraint mcp_activity_staff_fkey FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE SET NULL,
  constraint mcp_activity_chk CHECK (
    kind = any (array['tool'::text, 'connect'::text, 'deny'::text, 'refresh'::text, 'revoke'::text, 'register'::text, 'refused'::text])
    and (client_name is null or char_length(client_name) <= 80)
    and (tool is null or char_length(tool) <= 60)
    and (detail is null or char_length(detail) <= 500)
    and (ip is null or char_length(ip) <= 64)
    and (ua is null or char_length(ua) <= 300)
  )
);
create index mcp_activity_at_idx on public.mcp_activity using btree (at desc);

-- ── Server only ─────────────────────────────────────────────────────────────
alter table public.mcp_clients enable row level security;
alter table public.mcp_auth_codes enable row level security;
alter table public.mcp_grants enable row level security;
alter table public.mcp_tokens enable row level security;
alter table public.mcp_activity enable row level security;
revoke all on table public.mcp_clients, public.mcp_auth_codes, public.mcp_grants, public.mcp_tokens, public.mcp_activity
  from anon, authenticated;
grant select, insert, update, delete on table
  public.mcp_clients, public.mcp_auth_codes, public.mcp_grants, public.mcp_tokens, public.mcp_activity to service_role;
revoke all on sequence public.mcp_activity_id_seq from anon, authenticated;
