// Central config for the CRM. Public values are safe in the browser; the
// service-role key is only ever imported by server-only modules.
export const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
export const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
export const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export const SUPABASE_READY = Boolean(SUPABASE_URL && ANON_KEY);
export const ADMIN_READY = Boolean(SUPABASE_URL && SERVICE_KEY);

// httpOnly session cookies (never readable by client JS).
export const AT_COOKIE = "rcg_at";
export const RT_COOKIE = "rcg_rt";

export const UPLOAD_BUCKET = "quote-uploads";

// Public site origin used to build the customer/contractor links you text out.
export const SITE_ORIGIN = (process.env.NEXT_PUBLIC_SITE_URL || "https://raleighconcrete.net").replace(/\/$/, "");

// Quote pipeline (re-exported from constants so server code can keep importing
// from env; client components should import from ./constants directly).
export { STATUSES, STATUS_LABELS, type Status } from "./constants";
