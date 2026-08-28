// Central config for the CRM. Public values are safe in the browser; the
// service-role key is only ever imported by server-only modules.
//
// Hard stop: this module carries the service-role key and must never be pulled
// into a client bundle. Next already strips non-NEXT_PUBLIC_ env vars from the
// browser, but this guard fails loudly if the module is ever imported in a
// client component instead of silently shipping an empty key.
if (typeof window !== "undefined") {
  throw new Error("@/lib/crm/env is server-only and must not be imported from client code.");
}

export const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
export const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
export const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export const SUPABASE_READY = Boolean(SUPABASE_URL && ANON_KEY);
export const ADMIN_READY = Boolean(SUPABASE_URL && SERVICE_KEY);

// httpOnly session cookies (never readable by client JS).
export const AT_COOKIE = "rcg_at";
export const RT_COOKIE = "rcg_rt";

// How long a signed-in session survives the browser closing.
//
// Owners deliberately get NO maxAge - a browser-session cookie that dies with
// the window. An owner can read every customer's details, create leads and add
// or remove staff, so an office machine someone walks away from should not stay
// signed in.
//
// Contractors get a week. They work off a phone between jobs, where the browser
// being closed or swapped out is normal, and a login screen at 7am on a
// driveway is friction that buys nothing: their session can only reach the jobs
// assigned to them, and RLS enforces that on the database regardless of how
// long the cookie lives.
export const CONTRACTOR_SESSION_DAYS = 7;

const BASE_COOKIE_OPTS = { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/" };

// Both the login route and the middleware's token refresh write these cookies,
// and they MUST agree: a refresh that forgot the maxAge would quietly demote a
// contractor's week-long session back to a browser-session one an hour after
// they signed in.
export function sessionCookieOpts(role: string | null | undefined) {
  return role === "contractor"
    ? { ...BASE_COOKIE_OPTS, maxAge: CONTRACTOR_SESSION_DAYS * 24 * 60 * 60 }
    : BASE_COOKIE_OPTS;
}

export const UPLOAD_BUCKET = "quote-uploads";

// Private bucket holding signed contracts. Served only through
// /crm/api/agreement, which scopes access with RLS.
export const AGREEMENT_BUCKET = "agreements";

// Public site origin used to build the customer/contractor links you text out.
export const SITE_ORIGIN = (process.env.NEXT_PUBLIC_SITE_URL || "https://raleighconcrete.net").replace(/\/$/, "");

// Quote pipeline (re-exported from constants so server code can keep importing
// from env; client components should import from ./constants directly).
export { STATUSES, STATUS_LABELS, type Status } from "./constants";
