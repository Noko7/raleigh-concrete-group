// The connector's records, all server-only (RLS on, no policies; read and written with the service role after
// the caller is checked). Every token is stored as its SHA-256 hash.
import { isStaffAllowed } from "@/lib/crm/access";
import { SITE_ORIGIN } from "@/lib/crm/env";
import { readAppSettings, writeAppSettings } from "@/lib/crm/queries/staff";
import { pgAdmin } from "@/lib/crm/rest";

import {
  ACCESS_TTL_MS,
  CODE_TTL_MS,
  GRANT_MAX_AGE_MS,
  hashToken,
  newToken,
  REFRESH_TTL_MS,
  sameHash,
  type AuthMethod,
  type Registration,
} from "./policy";

// ── Addresses ────────────────────────────────────────────────────────────────
export const ISSUER = SITE_ORIGIN;
export const MCP_URL = `${SITE_ORIGIN}/api/mcp`;
export const AUTHORIZE_URL = `${SITE_ORIGIN}/crm/connect`;
export const TOKEN_URL = `${SITE_ORIGIN}/api/mcp/oauth/token`;
export const REGISTER_URL = `${SITE_ORIGIN}/api/mcp/oauth/register`;
export const REVOKE_URL = `${SITE_ORIGIN}/api/mcp/oauth/revoke`;
export const RESOURCE_METADATA_URL = `${SITE_ORIGIN}/.well-known/oauth-protected-resource`;

// ── The switch (Security page) ───────────────────────────────────────────────
// Off unless the owner turned it on, and off if the setting can't be read.
export async function connectorEnabled(): Promise<boolean> {
  const data = await readAppSettings().catch(() => ({}) as Record<string, unknown>);
  return data.claude_connector === true;
}

export async function setConnectorEnabled(on: boolean): Promise<boolean> {
  return writeAppSettings({ claude_connector: on });
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const iso = (ms: number) => new Date(ms).toISOString();
const nowIso = () => new Date().toISOString();

async function rows<T>(path: string, init?: Parameters<typeof pgAdmin>[1]): Promise<T[]> {
  const res = await pgAdmin(path, init);
  if (!res.ok) throw new Error(`connector store: HTTP ${res.status} on ${path.split("?")[0]}`);
  const text = await res.text();
  return text ? (JSON.parse(text) as T[]) : [];
}

const RETURN = { headers: { Prefer: "return=representation" } };

// ── Clients ──────────────────────────────────────────────────────────────────
export type Client = {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  auth_method: AuthMethod;
  secret_hash: string | null;
};

export async function registerClient(reg: Registration, ip: string): Promise<{ client: Client; secret: string | null }> {
  const clientId = `rcg_client_${crypto.randomUUID()}`;
  const secret = reg.authMethod === "none" ? null : newToken("client");
  const [client] = await rows<Client>("mcp_clients?select=client_id,client_name,redirect_uris,auth_method,secret_hash", {
    method: "POST",
    ...RETURN,
    body: JSON.stringify({
      client_id: clientId,
      client_name: reg.clientName,
      redirect_uris: reg.redirectUris,
      auth_method: reg.authMethod,
      secret_hash: secret ? hashToken(secret) : null,
      created_ip: ip.slice(0, 64),
    }),
  });
  return { client, secret };
}

export async function getClient(clientId: string): Promise<Client | null> {
  if (!/^rcg_client_[0-9a-f-]{36}$/.test(clientId)) return null;
  const [c] = await rows<Client>(
    `mcp_clients?client_id=eq.${clientId}&select=client_id,client_name,redirect_uris,auth_method,secret_hash&limit=1`,
  );
  return c ?? null;
}

export function clientSecretOk(client: Client, secret: string | null): boolean {
  if (client.auth_method === "none") return true;
  return Boolean(secret && client.secret_hash && sameHash(hashToken(secret), client.secret_hash));
}

// ── Owners ───────────────────────────────────────────────────────────────────
type StaffRow = { id: string; role: string; active: boolean; email: string | null; full_name: string | null };

// Checked at approval and again on every single call: an owner demoted or deactivated loses the connector at once.
export async function activeOwner(staffId: string): Promise<StaffRow | null> {
  const [s] = await rows<StaffRow>(`staff?id=eq.${staffId}&select=id,role,active,email,full_name&limit=1`);
  if (!s || !s.active || s.role !== "owner" || !isStaffAllowed(s.role, s.email)) return null;
  return s;
}

// ── Approval codes ───────────────────────────────────────────────────────────
export async function issueCode(i: {
  clientId: string;
  staffId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
}): Promise<string> {
  const code = newToken("code");
  await rows("mcp_auth_codes", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      code_hash: hashToken(code),
      client_id: i.clientId,
      staff_id: i.staffId,
      redirect_uri: i.redirectUri,
      code_challenge: i.codeChallenge,
      scope: i.scope,
      expires_at: iso(Date.now() + CODE_TTL_MS),
    }),
  });
  return code;
}

type CodeRow = { client_id: string; staff_id: string; redirect_uri: string; code_challenge: string; scope: string };

// Single use: the update only matches an unused, unexpired code, so two racing exchanges can't both win.
export async function consumeCode(code: string): Promise<CodeRow | null> {
  const [row] = await rows<CodeRow>(
    `mcp_auth_codes?code_hash=eq.${hashToken(code)}&used_at=is.null&expires_at=gt.${nowIso()}&select=client_id,staff_id,redirect_uri,code_challenge,scope`,
    { method: "PATCH", ...RETURN, body: JSON.stringify({ used_at: nowIso() }) },
  );
  return row ?? null;
}

// ── Connections (grants) and their tokens ────────────────────────────────────
export type Grant = {
  id: string;
  client_id: string;
  staff_id: string;
  scope: string;
  expires_at: string;
  revoked_at: string | null;
  client_name: string;
};

export type TokenPair = { access_token: string; refresh_token: string; expires_in: number; scope: string };

async function mintPair(grantId: string, scope: string): Promise<TokenPair> {
  const access = newToken("access");
  const refresh = newToken("refresh");
  await rows("mcp_tokens", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify([
      { token_hash: hashToken(access), kind: "access", grant_id: grantId, expires_at: iso(Date.now() + ACCESS_TTL_MS) },
      { token_hash: hashToken(refresh), kind: "refresh", grant_id: grantId, expires_at: iso(Date.now() + REFRESH_TTL_MS) },
    ]),
  });
  return { access_token: access, refresh_token: refresh, expires_in: Math.floor(ACCESS_TTL_MS / 1000), scope };
}

export async function createGrant(i: { clientId: string; staffId: string; scope: string; clientName: string; ip: string }) {
  const [grant] = await rows<{ id: string }>("mcp_grants?select=id", {
    method: "POST",
    ...RETURN,
    body: JSON.stringify({
      client_id: i.clientId,
      staff_id: i.staffId,
      scope: i.scope,
      client_name: i.clientName,
      expires_at: iso(Date.now() + GRANT_MAX_AGE_MS),
      last_ip: i.ip.slice(0, 64),
    }),
  });
  return { grantId: grant.id, tokens: await mintPair(grant.id, i.scope) };
}

const GRANT_COLS = "id,client_id,staff_id,scope,expires_at,revoked_at,client_name";

function live(g: Grant | undefined | null): g is Grant {
  return Boolean(g && !g.revoked_at && Date.parse(g.expires_at) > Date.now());
}

type TokenRow = { grant_id: string; used_at: string | null; expires_at: string; mcp_grants: Grant | null };

// The per-call check: a live access token, on a live connection.
export async function grantForAccessToken(token: string): Promise<Grant | null> {
  const [t] = await rows<TokenRow>(
    `mcp_tokens?token_hash=eq.${hashToken(token)}&kind=eq.access&expires_at=gt.${nowIso()}&select=grant_id,used_at,expires_at,mcp_grants(${GRANT_COLS})&limit=1`,
  );
  return live(t?.mcp_grants) ? t.mcp_grants : null;
}

export type RefreshResult =
  | { ok: true; grant: Grant; tokens: TokenPair }
  | { ok: false; reason: "unknown" | "reused" | "expired" | "revoked"; grant?: Grant };

// Rotation: a refresh token works once. Seeing a used one again means two parties hold it, so the connection is
// revoked for both (RFC 9700 §4.14.2).
export async function rotateRefresh(token: string, clientId: string): Promise<RefreshResult> {
  const hash = hashToken(token);
  const [claimed] = await rows<TokenRow>(
    `mcp_tokens?token_hash=eq.${hash}&kind=eq.refresh&used_at=is.null&expires_at=gt.${nowIso()}&select=grant_id,used_at,expires_at,mcp_grants(${GRANT_COLS})`,
    { method: "PATCH", ...RETURN, body: JSON.stringify({ used_at: nowIso() }) },
  );
  if (claimed) {
    const g = claimed.mcp_grants;
    if (!g || g.client_id !== clientId) return { ok: false, reason: "unknown" };
    if (g.revoked_at) return { ok: false, reason: "revoked", grant: g };
    if (Date.parse(g.expires_at) <= Date.now()) return { ok: false, reason: "expired", grant: g };
    return { ok: true, grant: g, tokens: await mintPair(g.id, g.scope) };
  }
  const [seen] = await rows<TokenRow>(
    `mcp_tokens?token_hash=eq.${hash}&kind=eq.refresh&select=grant_id,used_at,expires_at,mcp_grants(${GRANT_COLS})&limit=1`,
  );
  if (!seen?.mcp_grants || seen.mcp_grants.client_id !== clientId) return { ok: false, reason: "unknown" };
  if (seen.used_at) {
    await revokeGrant(seen.grant_id, "refresh token reused");
    return { ok: false, reason: "reused", grant: seen.mcp_grants };
  }
  return { ok: false, reason: "expired", grant: seen.mcp_grants };
}

// Revoking a connection kills its tokens: every check joins through the grant.
export async function revokeGrant(grantId: string, reason: string): Promise<boolean> {
  const res = await pgAdmin(`mcp_grants?id=eq.${grantId}&revoked_at=is.null`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ revoked_at: nowIso(), revoked_reason: reason.slice(0, 120) }),
  });
  if (res.ok) await pgAdmin(`mcp_tokens?grant_id=eq.${grantId}`, { method: "DELETE" });
  return res.ok;
}

export async function revokeAllGrants(reason: string): Promise<number> {
  const live = await rows<{ id: string }>("mcp_grants?revoked_at=is.null&select=id");
  for (const g of live) await revokeGrant(g.id, reason);
  return live.length;
}

// For RFC 7009: whichever kind of token it is, its connection goes.
export async function grantIdForAnyToken(token: string): Promise<{ grantId: string; clientId: string } | null> {
  const [t] = await rows<{ grant_id: string; mcp_grants: { client_id: string } | null }>(
    `mcp_tokens?token_hash=eq.${hashToken(token)}&select=grant_id,mcp_grants(client_id)&limit=1`,
  );
  return t?.mcp_grants ? { grantId: t.grant_id, clientId: t.mcp_grants.client_id } : null;
}

export async function touchGrant(grantId: string, ip: string): Promise<void> {
  await pgAdmin(`mcp_grants?id=eq.${grantId}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ last_used_at: nowIso(), last_ip: ip.slice(0, 64) }),
  }).catch(() => undefined);
}

// ── Activity (Security page) ─────────────────────────────────────────────────
export type ActivityKind = "tool" | "connect" | "deny" | "refresh" | "revoke" | "register" | "refused";

export async function logActivity(a: {
  kind: ActivityKind;
  ok: boolean;
  grantId?: string | null;
  staffId?: string | null;
  clientName?: string | null;
  tool?: string | null;
  detail?: string | null;
  ip?: string | null;
  ua?: string | null;
}): Promise<void> {
  await pgAdmin("mcp_activity", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      kind: a.kind,
      ok: a.ok,
      grant_id: a.grantId ?? null,
      staff_id: a.staffId ?? null,
      client_name: a.clientName?.slice(0, 80) ?? null,
      tool: a.tool?.slice(0, 60) ?? null,
      detail: a.detail?.slice(0, 500) ?? null,
      ip: a.ip?.slice(0, 64) ?? null,
      ua: a.ua?.slice(0, 300) ?? null,
    }),
  }).catch(() => undefined);
}

export type ConnectionRow = {
  id: string;
  client_name: string;
  staff_id: string;
  scope: string;
  created_at: string;
  last_used_at: string | null;
  last_ip: string | null;
  expires_at: string;
  revoked_at: string | null;
  revoked_reason: string | null;
};

export async function listConnections(limit = 50): Promise<ConnectionRow[]> {
  return rows<ConnectionRow>(
    `mcp_grants?select=id,client_name,staff_id,scope,created_at,last_used_at,last_ip,expires_at,revoked_at,revoked_reason&order=created_at.desc&limit=${limit}`,
  );
}

export type ActivityRow = {
  id: number;
  at: string;
  kind: ActivityKind;
  ok: boolean;
  staff_id: string | null;
  client_name: string | null;
  tool: string | null;
  detail: string | null;
  ip: string | null;
};

export async function listActivity(limit = 100): Promise<ActivityRow[]> {
  return rows<ActivityRow>(`mcp_activity?select=id,at,kind,ok,staff_id,client_name,tool,detail,ip&order=at.desc&limit=${limit}`);
}

// ── Housekeeping (the daily cron) ────────────────────────────────────────────
// Expired codes and tokens a day after they lapse, activity after 90 days, and registrations that never led to a
// connection after a week. Done here rather than in a database function so the schema needs no DELETE of its own.
export async function purgeConnectorRecords(): Promise<{ ok: boolean }> {
  const dayAgo = iso(Date.now() - 24 * 60 * 60 * 1000);
  const quarterAgo = iso(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const weekAgo = iso(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const del = (path: string) => pgAdmin(path, { method: "DELETE", headers: { Prefer: "return=minimal" } }).then((r) => r.ok);

  const results = await Promise.all([
    del(`mcp_auth_codes?expires_at=lt.${dayAgo}`),
    del(`mcp_tokens?expires_at=lt.${dayAgo}`),
    del(`mcp_activity?at=lt.${quarterAgo}`),
  ]);
  // A registration with no connection, a week old: a stray or abandoned sign-in attempt.
  const connected = await rows<{ client_id: string }>("mcp_grants?select=client_id").catch(() => null);
  if (connected) {
    const keep = [...new Set(connected.map((g) => g.client_id))].filter((id) => /^rcg_client_[0-9a-f-]{36}$/.test(id));
    const notIn = keep.length ? `&client_id=not.in.(${keep.join(",")})` : "";
    results.push(await del(`mcp_clients?created_at=lt.${weekAgo}${notIn}`));
  }
  return { ok: results.every(Boolean) && connected !== null };
}
