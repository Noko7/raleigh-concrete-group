// Server-only Supabase REST/Auth helpers. Do NOT import from client components:
// this module references the service-role key.
import { SUPABASE_URL, ANON_KEY, SERVICE_KEY } from "./env";

const REST = `${SUPABASE_URL}/rest/v1`;
const AUTH = `${SUPABASE_URL}/auth/v1`;

type Init = RequestInit & { headers?: Record<string, string> };

// PostgREST as the logged-in user (RLS enforces owner/contractor scoping).
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

// PostgREST with the service-role key (bypasses RLS). Use ONLY where there is no
// user session: the public customer/job token pages, view tracking, and admin
// tasks where we have already verified the caller is an owner.
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

// ── Auth (GoTrue) ───────────────────────────────────────────────────────────
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

// Owner-only: create a contractor's auth account with a temporary password.
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
