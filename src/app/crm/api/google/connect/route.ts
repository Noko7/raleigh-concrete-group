import { NextResponse } from "next/server";

import { getSession } from "@/lib/crm/auth";
import { googleAuthUrl, googleConfigured } from "@/lib/crm/gcal";

export const dynamic = "force-dynamic";

// Owner-only. A random state in an httpOnly cookie, verified on the callback, blocks CSRF.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session || session.staff.role !== "owner") {
    return NextResponse.redirect(new URL("/crm/login", request.url));
  }
  if (!googleConfigured()) {
    return NextResponse.redirect(new URL("/crm/calendar?google=unconfigured", request.url));
  }

  const state = crypto.randomUUID().replace(/-/g, "");
  const res = NextResponse.redirect(googleAuthUrl(state));
  res.cookies.set("rcg_gstate", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
