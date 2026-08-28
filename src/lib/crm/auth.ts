import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { isStaffAllowed } from "./access";
import { AT_COOKIE } from "./env";
import { getAuthUser, pgAdmin } from "./rest";
import type { Session, Staff } from "./types";

// Resolve the current session from the httpOnly access-token cookie. Middleware
// refreshes the token before server components run, so by the time we read it
// here it should be valid. We verify it against Supabase (signature + expiry)
// and load the staff profile with the service-role key.
//
// Wrapped in React's cache() so those two round-trips happen ONCE per request
// rather than once per caller. Every CRM page had been paying for them twice -
// the layout renders the top bar from the session and then the page asks for it
// again - and a page that also runs a server action paid a third time. The
// memo lives for a single render pass, so this is deduplication, not a stored
// session: a signed-out user is still signed out on their very next request.
export const getSession = cache(async function getSession(): Promise<Session | null> {
  const at = (await cookies()).get(AT_COOKIE)?.value;
  if (!at) return null;

  const user = await getAuthUser(at);
  if (!user) return null;

  const res = await pgAdmin(`staff?id=eq.${user.id}&select=*&limit=1`);
  if (!res.ok) return null;
  const rows = (await res.json()) as Staff[];
  const staff = rows[0];
  if (!staff || !staff.active) return null;
  if (!isStaffAllowed(staff.role, staff.email ?? user.email)) return null;

  return { accessToken: at, user, staff };
});

export async function requireSession(loginPath = "/crm/login"): Promise<Session> {
  const session = await getSession();
  if (!session) redirect(loginPath);
  return session;
}

export async function requireOwner(loginPath = "/crm/login"): Promise<Session> {
  const session = await requireSession(loginPath);
  if (session.staff.role !== "owner") redirect("/crm");
  return session;
}
