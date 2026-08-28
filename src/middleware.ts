import { NextResponse, type NextRequest } from "next/server";

import { isStaffAllowed } from "@/lib/crm/access";
import { AT_COOKIE, RT_COOKIE, sessionCookieOpts } from "@/lib/crm/env";
import { clientIp, rateLimit } from "@/lib/rate-limit";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// Decode only the expiry from a JWT (no signature check) to decide whether to
// refresh. Identity/authorization is NEVER trusted from this — see verifyUser,
// which validates the token's signature with Supabase before we act on it.
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

const ACCESS_CACHE_TTL_MS = 3 * 60 * 1000;
const accessCache = new Map<string, { active: boolean; role: string | null; email: string | null; ts: number }>();

// Verified-identity cache, keyed by the access token. We confirm the token's
// signature + expiry with Supabase (which rejects forged/altered tokens) and
// only then trust its `sub`/`email`. Cached briefly to avoid a round-trip on
// every CRM navigation.
const authCache = new Map<string, { id: string; email: string | null; ts: number }>();

async function verifyUser(accessToken: string): Promise<{ id: string; email: string | null } | null> {
  const cached = authCache.get(accessToken);
  if (cached && Date.now() - cached.ts < ACCESS_CACHE_TTL_MS) return cached;
  if (!SUPABASE_URL || !ANON_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      cache: "no-store",
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const u = (await res.json()) as { id?: string; email?: string };
    if (!u?.id) return null;
    const value = { id: u.id, email: u.email ?? null, ts: Date.now() };
    if (authCache.size > 8000) authCache.clear();
    authCache.set(accessToken, value);
    return value;
  } catch {
    return null;
  }
}

function withNoIndex(response: NextResponse): NextResponse {
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  return response;
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

  // The CRM lives under /crm (mapped from the crm.* subdomain). Contractor job
  // pages (/job/*) also require a logged-in staff session; everything else is
  // the public marketing site / customer token pages - leave it untouched.
  const isJobPath = pathname.startsWith("/job/");
  const touchesCrm = isCrmHost || pathname.startsWith("/crm");
  if (!touchesCrm && !isJobPath) {
    // Allow Google to index the public marketing pages. Keep private customer
    // token pages and API endpoints out of search with a noindex header.
    const keepPrivate =
      pathname.startsWith("/q/") ||
      // Contractor onboarding: public by design (they have no login yet), but a
      // capability link that must never be indexed.
      pathname.startsWith("/join/") ||
      pathname.startsWith("/confirm") ||
      pathname.startsWith("/api/");
    return keepPrivate ? withNoIndex(NextResponse.next()) : NextResponse.next();
  }

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

  // CRM-relative path with any /crm prefix stripped, so the checks below behave
  // the same whether we arrived via crm.host/login or apex/crm/login.
  const normalized = pathname.startsWith("/crm") ? pathname.slice(4) || "/" : pathname;
  const isLogin = normalized === "/login";
  const isAuthApi = normalized.startsWith("/api/login") || normalized.startsWith("/api/logout");

  // Rate limit CRM/API surface (durable across instances when Upstash is set).
  const ip = clientIp(request);
  const rlKeyBase = `${ip}:${normalized}`;
  if (normalized.startsWith("/api/login")) {
    if (await rateLimit(`login:${rlKeyBase}`, 12, 10 * 60 * 1000)) {
      return withNoIndex(NextResponse.json({ ok: false, error: "Too many login attempts." }, { status: 429 }));
    }
  } else if (normalized.startsWith("/api/")) {
    if (await rateLimit(`api:${rlKeyBase}`, 120, 60 * 1000)) {
      return withNoIndex(NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429 }));
    }
  } else if (await rateLimit(`page:${ip}`, 300, 60 * 1000)) {
    return withNoIndex(new NextResponse("Too many requests.", { status: 429 }));
  }

  // Verify the session token's signature with Supabase. A forged or tampered
  // token yields no verified identity, so it's treated as signed-out.
  const verified = accessToken ? await verifyUser(accessToken) : null;
  const hasSession = Boolean(verified);

  // Guard: signed-out users can only reach the login page + auth endpoints.
  if (!hasSession && !isLogin && !isAuthApi) {
    const url = request.nextUrl.clone();
    url.pathname = isCrmHost ? "/login" : "/crm/login";
    url.search = isJobPath ? `?next=${encodeURIComponent(pathname)}` : "";
    return withNoIndex(NextResponse.redirect(url));
  }
  // Signed-in users skip the login screen.
  if (hasSession && isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = isCrmHost ? "/" : "/crm";
    url.search = "";
    return withNoIndex(NextResponse.redirect(url));
  }

  // Authorize every authenticated CRM route from the VERIFIED identity (never
  // raw token claims). There's no standalone email pre-check any more: the
  // allowlist only applies to owners, so the role has to be known first, and
  // that means loading the staff row. It's cached, so this is one lookup per
  // user per few minutes rather than per request.
  // Needed again at the bottom: a refreshed cookie has to be written with the
  // same lifetime the role earned it at login.
  let staffRole: string | null = null;
  if (hasSession && !isAuthApi && verified) {
    const tokenEmail = (verified.email ?? "").toLowerCase();
    const userId = verified.id;
    if (userId) {
      const staff = await getStaffAccess(userId);
      staffRole = staff?.role ?? null;
      if (!staff || !staff.active || !isStaffAllowed(staff.role, staff.email ?? tokenEmail)) {
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
    // The role is normally already in hand from the authorization check above.
    // On the paths that skip it (the auth endpoints) look it up rather than
    // defaulting: guessing "owner" here would expire a contractor's week-long
    // session the moment their access token rolled over, which is the exact
    // problem the longer lifetime exists to fix. getStaffAccess is cached, so
    // this is almost always free.
    const role = staffRole ?? (verified ? ((await getStaffAccess(verified.id))?.role ?? null) : null);
    const opts = sessionCookieOpts(role);
    response.cookies.set(AT_COOKIE, refreshed.access_token, opts);
    response.cookies.set(RT_COOKIE, refreshed.refresh_token, opts);
  }
  return withNoIndex(response);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|images|robots.txt|sitemap.xml).*)"],
};
