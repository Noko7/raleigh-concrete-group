import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { AT_COOKIE, RT_COOKIE, ADMIN_READY } from "@/lib/crm/env";
import { signInWithPassword, pgAdmin } from "@/lib/crm/rest";
import type { Staff } from "@/lib/crm/types";

const COOKIE_OPTS = { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/" };

export async function POST(request: Request) {
  if (!ADMIN_READY) {
    return NextResponse.json({ ok: false, error: "CRM is not configured yet." }, { status: 503 });
  }

  let body: { email?: unknown; password?: unknown };
  try {
    body = (await request.json()) as { email?: unknown; password?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) {
    return NextResponse.json({ ok: false, error: "Email and password are required." }, { status: 400 });
  }

  const token = await signInWithPassword(email, password);
  if (!token) {
    return NextResponse.json({ ok: false, error: "Incorrect email or password." }, { status: 401 });
  }

  // Only users with an active staff row may use the CRM.
  const res = await pgAdmin(`staff?id=eq.${token.user.id}&select=active&limit=1`);
  const rows = res.ok ? ((await res.json()) as Pick<Staff, "active">[]) : [];
  if (!rows[0]?.active) {
    return NextResponse.json({ ok: false, error: "This account doesn't have CRM access." }, { status: 403 });
  }

  const jar = await cookies();
  jar.set(AT_COOKIE, token.access_token, COOKIE_OPTS);
  jar.set(RT_COOKIE, token.refresh_token, COOKIE_OPTS);
  return NextResponse.json({ ok: true });
}
