// CRM config. Carries the service-role key: this guard fails loudly if imported into a client bundle
// instead of silently shipping an empty key.
if (typeof window !== "undefined") {
  throw new Error("@/lib/crm/env is server-only and must not be imported from client code.");
}

export const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
export const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
export const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export const SUPABASE_READY = Boolean(SUPABASE_URL && ANON_KEY);
export const ADMIN_READY = Boolean(SUPABASE_URL && SERVICE_KEY);

// httpOnly session cookies.
export const AT_COOKIE = "rcg_at";
export const RT_COOKIE = "rcg_rt";

// Owners get NO maxAge (dies with the browser): they can see every customer and manage staff, so an
// unattended office machine shouldn't stay signed in.
// Contractors get a week: they work from phones, and RLS limits them to their own jobs regardless.
export const CONTRACTOR_SESSION_DAYS = 7;

const BASE_COOKIE_OPTS = { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/" };

// Used by both login and the middleware refresh; they MUST agree, or a refresh would demote a
// contractor's week-long session to a browser-session one.
export function sessionCookieOpts(role: string | null | undefined) {
  return role === "contractor"
    ? { ...BASE_COOKIE_OPTS, maxAge: CONTRACTOR_SESSION_DAYS * 24 * 60 * 60 }
    : BASE_COOKIE_OPTS;
}

export const UPLOAD_BUCKET = "quote-uploads";

// Private bucket; served only through /crm/api/agreement, which scopes access with RLS.
export const AGREEMENT_BUCKET = "agreements";

// Origin for the customer/contractor links we text out.
export const SITE_ORIGIN = (process.env.NEXT_PUBLIC_SITE_URL || "https://raleighconcrete.net").replace(/\/$/, "");

// Re-exported for server code; client components import from ./constants.
export { STATUSES, STATUS_LABELS, type Status } from "./constants";
