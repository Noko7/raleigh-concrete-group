// The Claude connector's security rules, as pure functions (no database, no env) so every one is unit-tested.
//
// The connector is an MCP server (/api/mcp) behind the CRM's own small OAuth 2.1 server:
//   - Claude registers itself (dynamic client registration), then sends the owner to /crm/connect.
//   - The owner, signed in to the CRM, approves. Claude gets a one-minute code, bound to PKCE.
//   - Claude swaps the code for a one-hour access token and a 30-day refresh token. Each refresh token works
//     once; a second use means it was copied, and the whole connection is revoked.
//   - Every token is random, stored only as a SHA-256 hash, and dies with its connection (revoked from the
//     Security page, the owner losing access, the connector switched off, or 90 days passing).
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// ── Lifetimes ────────────────────────────────────────────────────────────────
export const CODE_TTL_MS = 60 * 1000;
export const ACCESS_TTL_MS = 60 * 60 * 1000;
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// A connection is re-approved at least this often, however busy.
export const GRANT_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

// Read-only today. A write tool would come with its own scope, so a connection approved for reading can't
// gain it silently.
export const SCOPE_READ = "crm.read";
export const SUPPORTED_SCOPES = [SCOPE_READ] as const;

// ── Tokens ───────────────────────────────────────────────────────────────────
// 32 random bytes; the prefix says what a leaked string is (and lets secret scanners match it).
export type TokenKind = "code" | "access" | "refresh" | "client";
const PREFIX: Record<TokenKind, string> = {
  code: "rcg_code_",
  access: "rcg_at_",
  refresh: "rcg_rt_",
  client: "rcg_cs_",
};

export function newToken(kind: TokenKind): string {
  return PREFIX[kind] + randomBytes(32).toString("base64url");
}

export function tokenKindOf(token: string): TokenKind | null {
  for (const [kind, prefix] of Object.entries(PREFIX) as [TokenKind, string][]) {
    if (token.startsWith(prefix)) return kind;
  }
  return null;
}

// Only the hash is stored: a database leak hands over no usable token.
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

// ── PKCE (RFC 7636), S256 only ───────────────────────────────────────────────
const PKCE_VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;
const PKCE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

export function isPkceChallenge(challenge: string): boolean {
  return PKCE_CHALLENGE.test(challenge);
}

export function pkceMatches(verifier: string, challenge: string): boolean {
  if (!PKCE_VERIFIER.test(verifier) || !PKCE_CHALLENGE.test(challenge)) return false;
  const computed = createHash("sha256").update(verifier, "ascii").digest("base64url");
  return sameHash(computed, challenge);
}

// ── Where a code may be sent ─────────────────────────────────────────────────
// Only Claude: claude.ai / claude.com's callback, or Claude Code's loopback listener on the owner's own
// computer. Anything else can't even register, so a look-alike app can't be approved by mistake.
const HOSTED_CALLBACKS = new Set([
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function parse(uri: string): URL | null {
  if (typeof uri !== "string" || uri.length > 300) return null;
  try {
    return new URL(uri);
  } catch {
    return null;
  }
}

function isLoopback(u: URL): boolean {
  return u.protocol === "http:" && LOOPBACK_HOSTS.has(u.hostname);
}

export function isAllowedRedirectUri(uri: string): boolean {
  const u = parse(uri);
  if (!u || u.username || u.password || u.hash) return false;
  if (HOSTED_CALLBACKS.has(uri)) return true;
  // Claude Code listens on a loopback port of its choosing (RFC 8252 §7.3).
  return isLoopback(u) && /^\/[A-Za-z0-9/_-]{0,60}$/.test(u.pathname) && !u.search;
}

// Exact match against a registered URI, except a loopback port, which may change between runs.
export function redirectMatches(registered: readonly string[], given: string): boolean {
  if (!isAllowedRedirectUri(given)) return false;
  const g = parse(given)!;
  return registered.some((r) => {
    if (r === given) return true;
    const u = parse(r);
    return Boolean(u && isLoopback(u) && isLoopback(g) && u.hostname === g.hostname && u.pathname === g.pathname);
  });
}

// ── Client registration (RFC 7591) ───────────────────────────────────────────
export type AuthMethod = "none" | "client_secret_post" | "client_secret_basic";
export type Registration = { clientName: string; redirectUris: string[]; authMethod: AuthMethod };

export function parseRegistration(body: unknown): { ok: true; value: Registration } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Body must be a JSON object." };
  const b = body as Record<string, unknown>;

  const uris = b.redirect_uris;
  if (!Array.isArray(uris) || uris.length < 1 || uris.length > 5 || !uris.every((u) => typeof u === "string")) {
    return { ok: false, error: "redirect_uris must list 1 to 5 URIs." };
  }
  const bad = (uris as string[]).find((u) => !isAllowedRedirectUri(u));
  if (bad) return { ok: false, error: "Only Claude's own callback addresses can be registered." };

  const grantTypes = b.grant_types ?? ["authorization_code", "refresh_token"];
  if (
    !Array.isArray(grantTypes) ||
    !grantTypes.every((g) => g === "authorization_code" || g === "refresh_token") ||
    !grantTypes.includes("authorization_code")
  ) {
    return { ok: false, error: "Only authorization_code and refresh_token grants are supported." };
  }
  const responseTypes = b.response_types ?? ["code"];
  if (!Array.isArray(responseTypes) || responseTypes.some((r) => r !== "code")) {
    return { ok: false, error: "Only the code response type is supported." };
  }

  const method = b.token_endpoint_auth_method ?? "none";
  if (method !== "none" && method !== "client_secret_post" && method !== "client_secret_basic") {
    return { ok: false, error: "Unsupported token_endpoint_auth_method." };
  }

  // Shown on the approval screen and the Security page; plain text, short.
  const rawName = typeof b.client_name === "string" ? b.client_name : "";
  const clientName = cleanText(rawName, 80) || "Unnamed app";

  return { ok: true, value: { clientName, redirectUris: [...new Set(uris as string[])], authMethod: method } };
}

// Control characters and bidi overrides out, whitespace collapsed, length capped.
export function cleanText(s: string, max: number): string {
  return s
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

// ── The authorize request ────────────────────────────────────────────────────
export type AuthorizeRequest = {
  clientId: string;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  scope: string;
  resource: string | null;
};

export type AuthorizeParse =
  | { ok: true; value: AuthorizeRequest }
  // No trustworthy redirect: show the error on our own page, never bounce it to an unchecked address.
  | { ok: false; redirectable: false; error: string }
  // A known client and redirect, but a bad request: RFC 6749 sends the error back to the client.
  | { ok: false; redirectable: true; redirectUri: string; state: string | null; error: string; description: string };

export function parseAuthorize(
  params: Record<string, string | undefined>,
  client: { redirectUris: readonly string[] } | null,
  resourceUrl: string,
): AuthorizeParse {
  const clientId = params.client_id ?? "";
  if (!clientId || !client) return { ok: false, redirectable: false, error: "This app isn't registered with the CRM." };
  const redirectUri = params.redirect_uri ?? "";
  if (!redirectUri || !redirectMatches(client.redirectUris, redirectUri)) {
    return { ok: false, redirectable: false, error: "The return address doesn't match the one this app registered." };
  }
  const state = params.state ?? null;
  if (state !== null && state.length > 500) {
    return { ok: false, redirectable: false, error: "The request's state value is too long." };
  }
  const fail = (error: string, description: string): AuthorizeParse => ({
    ok: false,
    redirectable: true,
    redirectUri,
    state,
    error,
    description,
  });

  if (params.response_type !== "code") return fail("unsupported_response_type", "Only response_type=code is supported.");
  if (params.code_challenge_method !== "S256" || !isPkceChallenge(params.code_challenge ?? "")) {
    return fail("invalid_request", "PKCE with S256 is required.");
  }
  const requested = (params.scope ?? SCOPE_READ).split(" ").filter(Boolean);
  if (requested.length === 0 || requested.some((s) => !(SUPPORTED_SCOPES as readonly string[]).includes(s))) {
    return fail("invalid_scope", `Only ${SCOPE_READ} is available.`);
  }
  // RFC 8707: a token is only ever for this server.
  const resource = params.resource ?? null;
  if (resource !== null && resource.replace(/\/$/, "") !== resourceUrl) {
    return fail("invalid_target", "Tokens are only issued for this CRM's MCP endpoint.");
  }

  return {
    ok: true,
    value: { clientId, redirectUri, state, codeChallenge: params.code_challenge!, scope: SCOPE_READ, resource },
  };
}

export function withQuery(uri: string, params: Record<string, string | null>): string {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v !== null) u.searchParams.set(k, v);
  return u.toString();
}

// ── Bearer header ────────────────────────────────────────────────────────────
export function bearerOf(header: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer ([A-Za-z0-9_\-.~+/]+=*)$/.exec(header.trim());
  return m ? m[1] : null;
}
