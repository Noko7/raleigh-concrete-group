import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { isStaffAllowed } from "@/lib/crm/access";
import { AT_COOKIE, RT_COOKIE, ADMIN_READY, sessionCookieOpts } from "@/lib/crm/env";
import { logLoginAttempt, recentFailuresFor } from "@/lib/crm/queries";
import { signInWithPassword, pgAdmin } from "@/lib/crm/rest";
import type { Staff } from "@/lib/crm/types";
import { clientIp } from "@/lib/rate-limit";

// One generic message for every credential failure. We never echo back the
// submitted values or any database/auth error text, so probing the form (e.g.
// typing SQL fragments) just yields this same harmless response.
const BAD_CREDS = "Incorrect email or password.";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Per-ACCOUNT throttle, on top of the middleware's per-IP one.
//
// The IP limit stops one machine hammering the form. It does nothing about the
// same password list tried against the owner's address from a hundred
// addresses, which is the shape this actually takes - and the login_attempts
// table was already recording every one of them while nothing read it back.
//
// Ten consecutive failures, then a fifteen-minute cool-off. A person who has
// genuinely forgotten their password gets ten goes, which is more than anybody
// needs and few enough to make a list useless. The streak is counted since the
// last success, so getting in resets it.
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

  // Reject anything that isn't a plausible login with the same generic message,
  // before it ever reaches the auth service. No hint about what was wrong.
  if (!EMAIL_RE.test(email) || password.length < 1) {
    await logLoginAttempt({ email, success: false, reason: "invalid_format", ip, userAgent }).catch(() => {});
    return NextResponse.json({ ok: false, error: BAD_CREDS }, { status: 401 });
  }

  // Before the password reaches the auth service, not after. A locked account
  // must cost an attacker a round-trip that tells them nothing, and it must not
  // be possible to keep testing passwords against a locked account and read the
  // answer from how long the refusal took.
  //
  // Logged with its own reason so the Security dashboard shows the lockout
  // rather than a silent gap in the attempt log.
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

    // Only users with an active staff row may use the CRM. id is a server-issued
    // UUID from the verified token (not user input), and still URL-encoded.
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

    // Lifetime follows the role: a week on a contractor's phone, until the
    // browser closes for an owner. See sessionCookieOpts.
    const jar = await cookies();
    const opts = sessionCookieOpts(staff.role);
    jar.set(AT_COOKIE, token.access_token, opts);
    jar.set(RT_COOKIE, token.refresh_token, opts);
    return NextResponse.json({ ok: true });
  } catch {
    await logLoginAttempt({ email, success: false, reason: "error", ip, userAgent }).catch(() => {});
    // Never leak the underlying error; respond with a neutral, generic message.
    return NextResponse.json({ ok: false, error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
