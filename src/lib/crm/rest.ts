// Server-only: references the service-role key.
import { SUPABASE_URL, ANON_KEY, SERVICE_KEY } from "./env";

if (typeof window !== "undefined") {
  throw new Error("@/lib/crm/rest is server-only and must not be imported from client code.");
}

const REST = `${SUPABASE_URL}/rest/v1`;
const AUTH = `${SUPABASE_URL}/auth/v1`;

type Init = RequestInit & { headers?: Record<string, string> };

// As the logged-in user; RLS enforces owner/contractor scoping.
export async function pgUser(path: string, accessToken: string, init: Init = {}) {
  return fetch(`${REST}/${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

// Service role (bypasses RLS). ONLY where there's no user session (public token pages, view tracking) or
// the caller is already verified as owner.
export async function pgAdmin(path: string, init: Init = {}) {
  return fetch(`${REST}/${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

export type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: { id: string; email?: string };
};

export async function signInWithPassword(email: string, password: string): Promise<TokenResponse | null> {
  const res = await fetch(`${AUTH}/token?grant_type=password`, {
    method: "POST",
    cache: "no-store",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) return null;
  return (await res.json()) as TokenResponse;
}

export async function getAuthUser(accessToken: string): Promise<{ id: string; email?: string } | null> {
  const res = await fetch(`${AUTH}/user`, {
    cache: "no-store",
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  return (await res.json()) as { id: string; email?: string };
}

// Owner-only: temporary password.
export async function adminCreateUser(
  email: string,
  password: string,
  fullName: string,
): Promise<{ id: string } | { error: string }> {
  const res = await fetch(`${AUTH}/admin/users`, {
    method: "POST",
    cache: "no-store",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    }),
  });
  const json = (await res.json().catch(() => ({}))) as { id?: string; msg?: string; message?: string };
  if (!res.ok || !json.id) return { error: json.msg || json.message || "Could not create user." };
  return { id: json.id };
}

// Owner-only. Updates Supabase Auth (the identity), not just the staff profile. email_confirm skips
// verification the contractor couldn't complete.
export async function adminUpdateEmail(
  userId: string,
  email: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch(`${AUTH}/admin/users/${userId}`, {
    method: "PUT",
    cache: "no-store",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, email_confirm: true }),
  });
  if (res.ok) return { ok: true };
  const json = (await res.json().catch(() => ({}))) as { msg?: string; message?: string };
  const raw = json.msg || json.message || "Could not update the email.";
  // Usually: the address already belongs to another account.
  const friendly = /already|exists|registered/i.test(raw)
    ? "Another account already uses that email."
    : raw;
  return { ok: false, error: friendly };
}

// Owner-only. staff cascades from auth.users, taking agreements with it; assigned jobs fall back to unassigned.
export async function adminDeleteUser(userId: string): Promise<boolean> {
  const res = await fetch(`${AUTH}/admin/users/${userId}`, {
    method: "DELETE",
    cache: "no-store",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  return res.ok;
}

// For the forced first-login reset, after verifying the caller's own session.
export async function adminUpdatePassword(userId: string, password: string): Promise<boolean> {
  const res = await fetch(`${AUTH}/admin/users/${userId}`, {
    method: "PUT",
    cache: "no-store",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  return res.ok;
}
