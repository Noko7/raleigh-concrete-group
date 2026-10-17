import { NextResponse } from "next/server";

import { isLocale } from "@/lib/crm/i18n";
import { toE164 } from "@/lib/crm/notify";
import { consumeInvite, getUsableInvite } from "@/lib/crm/queries";
import { adminCreateUser, adminDeleteUser, pgAdmin } from "@/lib/crm/rest";
import { clientIp, rateLimit } from "@/lib/rate-limit";

// Public: redeems a contractor invite into an account. The only unauthenticated path that can create a
// login, so every step re-validates. One generic failure so "no such invite", "used" and "expired" look
// the same.
const GENERIC = "This invite link is no longer valid. Ask for a new one.";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_RE = /^[a-f0-9]{32}$/;

export async function POST(request: Request) {
  const ip = clientIp(request);
  // Tight cap: account creation behind a token.
  if (await rateLimit(`join:${ip}`, 8, 15 * 60 * 1000)) {
    return NextResponse.json({ ok: false, error: "Too many attempts. Please wait a few minutes." }, { status: 429 });
  }

  let body: {
    token?: unknown;
    full_name?: unknown;
    email?: unknown;
    password?: unknown;
    locale?: unknown;
    phone?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!TOKEN_RE.test(token)) return NextResponse.json({ ok: false, error: GENERIC }, { status: 400 });

  const fullName = (typeof body.full_name === "string" ? body.full_name : "").trim().slice(0, 120);
  const email = (typeof body.email === "string" ? body.email : "").trim().toLowerCase().slice(0, 254);
  const password = typeof body.password === "string" ? body.password : "";
  // Unshipped locales fall back to English rather than failing the check constraint.
  const locale = isLocale(body.locale) ? body.locale : "en";

  if (fullName.length < 2) {
    return NextResponse.json({ ok: false, error: "Enter your full name." }, { status: 400 });
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: false, error: "Enter a valid email address." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ ok: false, error: "Use a password of at least 8 characters." }, { status: 400 });
  }
  if (password.length > 72) {
    return NextResponse.json({ ok: false, error: "That password is too long." }, { status: 400 });
  }
  // SMS providers require E.164; normalise now while they can still fix it.
  const rawPhone = typeof body.phone === "string" ? body.phone : "";
  const phone = rawPhone.trim() ? toE164(rawPhone) : null;
  if (rawPhone.trim() && !phone) {
    return NextResponse.json(
      { ok: false, error: "Enter a valid US mobile number, e.g. (919) 555-1234." },
      { status: 400 },
    );
  }
  // No allowlist: their authorisation is the owner's invite, not their email domain.

  // Re-check: the invite may have been used or revoked since the page loaded.
  const invite = await getUsableInvite(token);
  if (!invite) return NextResponse.json({ ok: false, error: GENERIC }, { status: 400 });

  const created = await adminCreateUser(email, password, fullName);
  if ("error" in created) {
    // Don't burn the invite; let them retry with another address.
    return NextResponse.json({ ok: false, error: created.error }, { status: 400 });
  }

  // Conditional on still being unused, so of two racing submissions only one gets an account.
  if (!(await consumeInvite(invite.id, created.id))) {
    // The loser's login must not outlive the race. Deleting the auth user cascades to the inactive
    // staff row the signup trigger made.
    if (!(await adminDeleteUser(created.id))) {
      console.error("[contractor-join] could not delete the account that lost the invite race", { id: created.id });
    }
    return NextResponse.json({ ok: false, error: GENERIC }, { status: 409 });
  }

  // The signup trigger made an inactive contractor row; activate it (the invite is the approval).
  // must_reset_password stays false: they chose this password.
  const res = await pgAdmin(`staff?id=eq.${created.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      full_name: fullName,
      email,
      // Fall back to the invited number so there's always a way to reach them.
      phone: phone ?? invite.phone,
      role: "contractor",
      active: true,
      must_reset_password: false,
      locale,
    }),
  });
  if (!res.ok) {
    return NextResponse.json(
      { ok: false, error: "Your login was created but setup didn't finish. Ask the owner to check your account." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, email });
}
