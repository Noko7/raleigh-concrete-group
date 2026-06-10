import { NextResponse, type NextRequest } from "next/server";

import { AT_COOKIE, RT_COOKIE } from "@/lib/crm/env";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

// Decode a JWT payload (no signature check — Supabase validates that on every
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

export async function middleware(request: NextRequest) {
  const host = (request.headers.get("host") ?? "").split(":")[0];
  const isCrmHost = host.startsWith("crm.");
  const { pathname } = request.nextUrl;

  // The CRM lives under /crm (mapped from the crm.* subdomain). Everything else
  // is the public marketing site / token pages — leave it untouched.
  const touchesCrm = isCrmHost || pathname.startsWith("/crm");
  if (!touchesCrm) return NextResponse.next();

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

  // CRM-relative path with any /crm prefix stripped, so the checks below behave
  // the same whether we arrived via crm.host/login or apex/crm/login.
  const normalized = pathname.startsWith("/crm") ? pathname.slice(4) || "/" : pathname;
  const isLogin = normalized === "/login";
  const isAuthApi = normalized.startsWith("/api/login") || normalized.startsWith("/api/logout");

  // Guard: signed-out users can only reach the login page + auth endpoints.
  if (!hasSession && !isLogin && !isAuthApi) {
    const url = request.nextUrl.clone();
    url.pathname = isCrmHost ? "/login" : "/crm/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  // Signed-in users skip the login screen.
  if (hasSession && isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = isCrmHost ? "/" : "/crm";
    url.search = "";
    return NextResponse.redirect(url);
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
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|images|robots.txt|sitemap.xml).*)"],
};
