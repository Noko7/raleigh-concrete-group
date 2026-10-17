import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { isStaffAllowed } from "@/lib/crm/access";
import { AT_COOKIE, RT_COOKIE, ADMIN_READY, sessionCookieOpts } from "@/lib/crm/env";
import { logLoginAttempt, recentFailuresFor } from "@/lib/crm/queries";
import { signInWithPassword, pgAdmin } from "@/lib/crm/rest";
import type { Staff } from "@/lib/crm/types";
import { clientIp } from "@/lib/rate-limit";

// One generic message for every credential failure; never echo input or auth/database errors.
const BAD_CREDS = "Incorrect email or password.";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Per-ACCOUNT throttle on top of the middleware's per-IP one (which can't stop a distributed password
// list). Ten consecutive failures since the last success, then a 15-minute cool-off.
const MAX_FAILURES = 10;
const LOCKOUT_MS = 15 * 60 * 1000;
const LOCKED_OUT =
  "Too many failed sign-ins for this account. Wait 15 minutes and try again, or call the office.";

export async function POST(request: Request) {
  const ip = clientIp(request);
  const userAgent = request.headers.get("user-agent");

  if (!ADMIN_READY) {
    return NextResponse.json({ ok: false, error: "CRM is not configured yet." }, { status: 503 });
  }

  let body: { email?: unknown; password?: unknown };
  try {
    body = (await request.json()) as { email?: unknown; password?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const email = (typeof body.email === "string" ? body.email : "").trim().toLowerCase().slice(0, 254);
  const password = typeof body.password === "string" ? body.password.slice(0, 256) : "";

  // Implausible logins get the same generic message before reaching the auth service.
  if (!EMAIL_RE.test(email) || password.length < 1) {
    await logLoginAttempt({ email, success: false, reason: "invalid_format", ip, userAgent }).catch(() => {});
    return NextResponse.json({ ok: false, error: BAD_CREDS }, { status: 401 });
  }

  // Checked before the password reaches the auth service, so a locked account reveals nothing (including
  // via timing). Logged with its own reason for the Security dashboard.
  if ((await recentFailuresFor(email, LOCKOUT_MS)) >= MAX_FAILURES) {
    await logLoginAttempt({ email, success: false, reason: "locked_out", ip, userAgent }).catch(() => {});
    return NextResponse.json({ ok: false, error: LOCKED_OUT }, { status: 429 });
  }

  try {
    const token = await signInWithPassword(email, password);
    if (!token) {
      await logLoginAttempt({ email, success: false, reason: "bad_credentials", ip, userAgent }).catch(() => {});
      return NextResponse.json({ ok: false, error: BAD_CREDS }, { status: 401 });
    }

    // Only an active staff row may use the CRM. id comes from the verified token.
    const res = await pgAdmin(`staff?id=eq.${encodeURIComponent(token.user.id)}&select=active,role,email&limit=1`);
    const rows = res.ok ? ((await res.json()) as Pick<Staff, "active" | "role" | "email">[]) : [];
    const staff = rows[0];
    if (!staff?.active || !isStaffAllowed(staff.role, staff.email ?? token.user.email)) {
      await logLoginAttempt({
        email, success: false, reason: "no_access", staffId: token.user.id, ip, userAgent,
      }).catch(() => {});
      return NextResponse.json({ ok: false, error: "This account doesn't have CRM access." }, { status: 403 });
    }

    await logLoginAttempt({ email, success: true, reason: "ok", staffId: token.user.id, ip, userAgent }).catch(() => {});

    // Lifetime follows the role (see sessionCookieOpts).
    const jar = await cookies();
    const opts = sessionCookieOpts(staff.role);
    jar.set(AT_COOKIE, token.access_token, opts);
    jar.set(RT_COOKIE, token.refresh_token, opts);
    return NextResponse.json({ ok: true });
  } catch {
    await logLoginAttempt({ email, success: false, reason: "error", ip, userAgent }).catch(() => {});
    // Never leak the underlying error.
    return NextResponse.json({ ok: false, error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
