// Shared bits for the connector's routes.
import { NextResponse } from "next/server";

import { clientIp } from "@/lib/rate-limit";

import { AUTHORIZE_URL, ISSUER, MCP_URL, REGISTER_URL, RESOURCE_METADATA_URL, REVOKE_URL, TOKEN_URL } from "./store";
import { SUPPORTED_SCOPES } from "./policy";

// Nothing the connector answers is ever cached or indexed.
const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache", "X-Robots-Tag": "noindex, nofollow" };

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): NextResponse {
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

// RFC 6749 §5.2 error shape.
export function oauthError(error: string, description: string, status = 400, headers: Record<string, string> = {}) {
  return json({ error, error_description: description }, status, headers);
}

export function who(request: Request): { ip: string; ua: string } {
  return { ip: clientIp(request), ua: (request.headers.get("user-agent") ?? "").slice(0, 300) };
}

// Bodies are tiny; anything big is not a client of ours.
export async function readBody(request: Request, max = 16_384): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > max) return null;
  const text = await request.text();
  return text.length > max ? null : text;
}

// Form (the OAuth standard) or JSON, as a flat string map.
export function parseParams(text: string, contentType: string | null): Record<string, string> | null {
  const ct = (contentType ?? "").toLowerCase();
  try {
    if (ct.includes("application/json")) {
      const o = JSON.parse(text) as unknown;
      if (!o || typeof o !== "object" || Array.isArray(o)) return null;
      return Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v === "string")) as Record<string, string>;
    }
    const p = new URLSearchParams(text);
    const out: Record<string, string> = {};
    for (const [k, v] of p) {
      // A repeated parameter is malformed (RFC 6749 §3.1).
      if (Object.hasOwn(out, k)) return null;
      out[k] = v;
    }
    return out;
  } catch {
    return null;
  }
}

// client_secret_basic, if sent.
export function basicAuth(header: string | null): { id: string; secret: string } | null {
  const m = /^Basic ([A-Za-z0-9+/=]+)$/.exec((header ?? "").trim());
  if (!m) return null;
  const decoded = Buffer.from(m[1], "base64").toString("utf8");
  const i = decoded.indexOf(":");
  if (i < 0) return null;
  try {
    return { id: decodeURIComponent(decoded.slice(0, i)), secret: decodeURIComponent(decoded.slice(i + 1)) };
  } catch {
    return null;
  }
}

// ── Discovery documents ──────────────────────────────────────────────────────
export function protectedResourceMetadata() {
  return {
    resource: MCP_URL,
    authorization_servers: [ISSUER],
    scopes_supported: SUPPORTED_SCOPES,
    bearer_methods_supported: ["header"],
    resource_name: "Raleigh Concrete CRM",
  };
}

export function authorizationServerMetadata() {
  return {
    issuer: ISSUER,
    authorization_endpoint: AUTHORIZE_URL,
    token_endpoint: TOKEN_URL,
    registration_endpoint: REGISTER_URL,
    revocation_endpoint: REVOKE_URL,
    scopes_supported: SUPPORTED_SCOPES,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    revocation_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    authorization_response_iss_parameter_supported: true,
  };
}

export function unauthorized(description: string) {
  return json({ error: "invalid_token", error_description: description }, 401, {
    "WWW-Authenticate": `Bearer resource_metadata="${RESOURCE_METADATA_URL}", error="invalid_token", error_description="${description.replace(/"/g, "'")}"`,
  });
}
