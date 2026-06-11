import { NextResponse, type NextRequest } from "next/server";

import { AT_COOKIE, RT_COOKIE } from "@/lib/crm/env";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ALLOWED_EMAILS = new Set(
  (process.env.CRM_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean),
);
const ALLOWED_DOMAINS = new Set(
  (process.env.CRM_ALLOWED_DOMAINS ?? "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean),
);
const ALLOWED_ROLES = new Set(
  (process.env.CRM_ALLOWED_ROLES ?? "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean),
);

// Decode a JWT payload (no signature check - Supabase validates that on every
// API call; here we only need the expiry to decide whether to refresh).
function jwtExpMs(token: string): number {
  try {
    const part = token.split(".")[1];
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(part.length + ((4 - (part.length % 4)) % 4), "=");
    const json = JSON.parse(decodeURIComponent(escape(atob(b64)))) as { exp?: number };
    return (json.exp ?? 0) * 1000;
  } catch {
    return 0;
  }
}

function jwtPayload(token: string): { exp?: number; sub?: string; email?: string } {
  try {
    const part = token.split(".")[1];
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(part.length + ((4 - (part.length % 4)) % 4), "=");
    return JSON.parse(decodeURIComponent(escape(atob(b64)))) as { exp?: number; sub?: string; email?: string };
  } catch {
    return {};
  }
}

function emailAllowed(email: string | undefined): boolean {
  const normalized = (email ?? "").trim().toLowerCase();
  if (!normalized) return false;
  if (!ALLOWED_EMAILS.size && !ALLOWED_DOMAINS.size) return true;
  if (ALLOWED_EMAILS.has(normalized)) return true;
  const at = normalized.lastIndexOf("@");
  if (at < 0) return false;
  return ALLOWED_DOMAINS.has(normalized.slice(at + 1));
}

function roleAllowed(role: string | null | undefined): boolean {
  if (!role) return false;
  if (!ALLOWED_ROLES.size) return true;
  return ALLOWED_ROLES.has(role.toLowerCase());
}

async function refresh(refreshToken: string) {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) return null;
    return (await res.json()) as { access_token: string; refresh_token: string };
  } catch {
    return null;
  }
}

const COOKIE_OPTS = { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/" };
const ACCESS_CACHE_TTL_MS = 3 * 60 * 1000;
const accessCache = new Map<string, { active: boolean; role: string | null; email: string | null; ts: number }>();
const hits = new Map<string, number[]>();

function withNoIndex(response: NextResponse): NextResponse {
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  return response;
}

function clientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function limited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 8000) hits.clear();
  return recent.length > max;
}

async function getStaffAccess(userId: string) {
  const cached = accessCache.get(userId);
  if (cached && Date.now() - cached.ts < ACCESS_CACHE_TTL_MS) return cached;
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/staff?id=eq.${encodeURIComponent(userId)}&select=active,role,email&limit=1`,
      {
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          "Content-Type": "application/json",
        },
      },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{ active?: boolean; role?: string | null; email?: string | null }>;
    const row = rows[0];
    if (!row) return null;
    const value = {
      active: Boolean(row.active),
      role: row.role ?? null,
      email: row.email ?? null,
      ts: Date.now(),
    };
    accessCache.set(userId, value);
    return value;
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const host = (request.headers.get("host") ?? "").split(":")[0];
  const isCrmHost = host.startsWith("crm.");
  const { pathname } = request.nextUrl;

  // The CRM lives under /crm (mapped from the crm.* subdomain). Everything else
  // is the public marketing site / token pages - leave it untouched.
  const touchesCrm = isCrmHost || pathname.startsWith("/crm");
  if (!touchesCrm) return withNoIndex(NextResponse.next());

  // Keep the access token fresh so server components see a valid session.
  let accessToken = request.cookies.get(AT_COOKIE)?.value;
  const refreshToken = request.cookies.get(RT_COOKIE)?.value;
  let refreshed: { access_token: string; refresh_token: string } | null = null;
  if ((!accessToken || jwtExpMs(accessToken) < Date.now() + 30_000) && refreshToken) {
    refreshed = await refresh(refreshToken);
    if (refreshed) {
      accessToken = refreshed.access_token;
      request.cookies.set(AT_COOKIE, refreshed.access_token);
      request.cookies.set(RT_COOKIE, refreshed.refresh_token);
    }
  }
  const hasSession = Boolean(accessToken && jwtExpMs(accessToken) > Date.now());
  const token = accessToken ? jwtPayload(accessToken) : {};

  // CRM-relative path with any /crm prefix stripped, so the checks below behave
  // the same whether we arrived via crm.host/login or apex/crm/login.
  const normalized = pathname.startsWith("/crm") ? pathname.slice(4) || "/" : pathname;
  const isLogin = normalized === "/login";
  const isAuthApi = normalized.startsWith("/api/login") || normalized.startsWith("/api/logout");

  // Rate limit CRM/API surface.
  const ip = clientIp(request);
  const rlKeyBase = `${ip}:${normalized}`;
  if (normalized.startsWith("/api/login")) {
    if (limited(`login:${rlKeyBase}`, 12, 10 * 60 * 1000)) {
      return withNoIndex(NextResponse.json({ ok: false, error: "Too many login attempts." }, { status: 429 }));
    }
  } else if (normalized.startsWith("/api/")) {
    if (limited(`api:${rlKeyBase}`, 120, 60 * 1000)) {
      return withNoIndex(NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429 }));
    }
  } else if (limited(`page:${ip}`, 300, 60 * 1000)) {
    return withNoIndex(new NextResponse("Too many requests.", { status: 429 }));
  }

  // Guard: signed-out users can only reach the login page + auth endpoints.
  if (!hasSession && !isLogin && !isAuthApi) {
    const url = request.nextUrl.clone();
    url.pathname = isCrmHost ? "/login" : "/crm/login";
    url.search = "";
    return withNoIndex(NextResponse.redirect(url));
  }
  // Signed-in users skip the login screen.
  if (hasSession && isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = isCrmHost ? "/" : "/crm";
    url.search = "";
    return withNoIndex(NextResponse.redirect(url));
  }

  // Restrict by allowlisted email/domain and role for all authenticated CRM routes.
  if (hasSession && !isAuthApi) {
    const tokenEmail = (token.email ?? "").toLowerCase();
    if (!emailAllowed(tokenEmail)) {
      const url = request.nextUrl.clone();
      url.pathname = isCrmHost ? "/login" : "/crm/login";
      url.search = "";
      const denied = NextResponse.redirect(url);
      denied.cookies.delete(AT_COOKIE);
      denied.cookies.delete(RT_COOKIE);
      return withNoIndex(denied);
    }

    const userId = token.sub ?? "";
    if (userId) {
      const staff = await getStaffAccess(userId);
      if (!staff || !staff.active || !roleAllowed(staff.role) || !emailAllowed(staff.email ?? tokenEmail)) {
        const url = request.nextUrl.clone();
        url.pathname = isCrmHost ? "/login" : "/crm/login";
        url.search = "";
        const denied = NextResponse.redirect(url);
        denied.cookies.delete(AT_COOKIE);
        denied.cookies.delete(RT_COOKIE);
        return withNoIndex(denied);
      }
    }
  }

  // Map crm.host/<x> → /crm/<x> internally.
  let response: NextResponse;
  if (isCrmHost && !pathname.startsWith("/crm")) {
    const url = request.nextUrl.clone();
    url.pathname = `/crm${pathname === "/" ? "" : pathname}`;
    response = NextResponse.rewrite(url, { request });
  } else {
    response = NextResponse.next({ request });
  }

  if (refreshed) {
    response.cookies.set(AT_COOKIE, refreshed.access_token, COOKIE_OPTS);
    response.cookies.set(RT_COOKIE, refreshed.refresh_token, COOKIE_OPTS);
  }
  return withNoIndex(response);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|images|robots.txt|sitemap.xml).*)"],
};
