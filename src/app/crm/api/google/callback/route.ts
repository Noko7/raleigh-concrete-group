import { NextResponse } from "next/server";

import { getSession } from "@/lib/crm/auth";
import { exchangeAndStore } from "@/lib/crm/gcal";

export const dynamic = "force-dynamic";

// Verify the owner session and state cookie before exchanging the code.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session || session.staff.role !== "owner") {
    return NextResponse.redirect(new URL("/crm/login", request.url));
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const cookieState = request.headers.get("cookie")?.match(/rcg_gstate=([a-f0-9]+)/)?.[1];

  const back = (status: string) => {
    const res = NextResponse.redirect(new URL(`/crm/calendar?google=${status}`, request.url));
    res.cookies.set("rcg_gstate", "", { path: "/", maxAge: 0 });
    return res;
  };

  if (error) return back("denied");
  if (!code || !state || !cookieState || state !== cookieState) return back("badstate");

  const result = await exchangeAndStore(code);
  return back(result.ok ? "connected" : "error");
}
