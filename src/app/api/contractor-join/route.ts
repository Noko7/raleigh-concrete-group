import { NextResponse } from "next/server";

import { isEmailAllowed } from "@/lib/crm/access";
import { isLocale } from "@/lib/crm/i18n";
import { consumeInvite, getUsableInvite } from "@/lib/crm/queries";
import { adminCreateUser, pgAdmin } from "@/lib/crm/rest";
import { clientIp, rateLimit } from "@/lib/rate-limit";

// Public endpoint: redeems a contractor invite token into a real account. This
// is the only unauthenticated path in the app that can create a login, so every
// step re-validates rather than trusting the page that called it.
//
// The generic failure message is deliberate. An attacker guessing tokens should
// not be able to tell "no such invite" from "already used" from "expired".
const GENERIC = "This invite link is no longer valid. Ask for a new one.";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_RE = /^[a-f0-9]{32}$/;

export async function POST(request: Request) {
  const ip = clientIp(request);
  // Tight cap: this is account creation behind a guessable-in-principle token.
  if (await rateLimit(`join:${ip}`, 8, 15 * 60 * 1000)) {
    return NextResponse.json({ ok: false, error: "Too many attempts. Please wait a few minutes." }, { status: 429 });
  }

  let body: {
    token?: unknown;
    full_name?: unknown;
    email?: unknown;
    password?: unknown;
    locale?: unknown;
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
  // Whatever they picked on the form becomes their CRM language. Anything we
  // don't ship falls back to English rather than failing the check constraint.
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
  // An address outside the allowlist would produce an account that exists but is
  // refused at login, so stop here rather than building something unusable.
  if (!isEmailAllowed(email)) {
    return NextResponse.json(
      { ok: false, error: "That email can't be used for this CRM. Use your work address, or ask the owner." },
      { status: 400 },
    );
  }

  // Re-check the token server-side: the page's own check happened earlier and
  // the invite may have been used or revoked in between.
  const invite = await getUsableInvite(token);
  if (!invite) return NextResponse.json({ ok: false, error: GENERIC }, { status: 400 });

  const created = await adminCreateUser(email, password, fullName);
  if ("error" in created) {
    // Don't burn the invite - let them retry with a different address.
    return NextResponse.json({ ok: false, error: created.error }, { status: 400 });
  }

  // Burn the invite before finishing setup. This is conditional on it still
  // being unused, so if two submissions race, the loser stops here instead of
  // both ending up with an account.
  if (!(await consumeInvite(invite.id, created.id))) {
    return NextResponse.json({ ok: false, error: GENERIC }, { status: 409 });
  }

  // The signup trigger already made a staff row (inactive contractor). Fill in
  // their details and activate it - the owner invited this exact number, so
  // there's no second approval step. must_reset_password stays false because
  // they chose this password themselves.
  const res = await pgAdmin(`staff?id=eq.${created.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      full_name: fullName,
      email,
      // Their number comes from the invite the owner sent, not from the form,
      // so it can't be swapped for someone else's.
      phone: invite.phone,
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
