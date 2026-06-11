import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { isEmailAllowed, isRoleAllowed } from "./access";
import { AT_COOKIE } from "./env";
import { getAuthUser, pgAdmin } from "./rest";
import type { Session, Staff } from "./types";

// Resolve the current session from the httpOnly access-token cookie. Middleware
// refreshes the token before server components run, so by the time we read it
// here it should be valid. We verify it against Supabase (signature + expiry)
// and load the staff profile with the service-role key.
export async function getSession(): Promise<Session | null> {
  const at = (await cookies()).get(AT_COOKIE)?.value;
  if (!at) return null;

  const user = await getAuthUser(at);
  if (!user) return null;

  const res = await pgAdmin(`staff?id=eq.${user.id}&select=*&limit=1`);
  if (!res.ok) return null;
  const rows = (await res.json()) as Staff[];
  const staff = rows[0];
  if (!staff || !staff.active) return null;
  if (!isEmailAllowed(staff.email ?? user.email)) return null;
  if (!isRoleAllowed(staff.role)) return null;

  return { accessToken: at, user, staff };
}

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
