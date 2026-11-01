// The pieces of the site's own request log that need no network or framework: the row for a request and its key.
// Edge-safe; tested in request-log-write.test.ts.
import { cleanIp, cleanPath, probeReason, safeText } from "./request-logs.ts";

/**
 * Every API route the site has (src/app/api and src/app/crm/api; request-log-write.test.ts keeps this in step
 * with the files). A request for any other /api address is a guess: Next answers it with a 404 the middleware
 * can't see, so the row records the 404 and the probe tag itself.
 */
export const API_ROUTES = new Set([
  "/api/address", "/api/availability", "/api/change-response", "/api/confirm-job", "/api/contractor-join",
  "/api/cron/drain", "/api/cron/reminders", "/api/cron/visit-reminders", "/api/docuseal/webhook", "/api/funnel",
  "/api/logs/vercel", "/api/quote", "/api/quote-response", "/api/quote/draft", "/api/stripe/webhook",
  "/api/track-view", "/api/upload-url",
  "/crm/api/agreement", "/crm/api/agreement-upload", "/crm/api/file", "/crm/api/google/callback",
  "/crm/api/google/connect", "/crm/api/login", "/crm/api/logout", "/crm/api/quote-pdf",
]);

/** An /api (or /crm/api) address the site doesn't have. */
export function isUnknownApi(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, "") || "/";
  return (p.startsWith("/api/") || p.startsWith("/crm/api/")) && !API_ROUTES.has(p);
}

export type Headers_ = { get(name: string): string | null };

/**
 * One row's key: Vercel's request id when there is one (it is on every request Vercel serves), else random.
 * x-vercel-id lists the regions the request passed through, then the id ("iad1::iad1::abcde-123-..."); the
 * middleware and the function can see different region prefixes, so only the trailing id is used.
 */
export function requestKey(headers: Headers_): string {
  const vid = headers.get("x-vercel-id");
  const tail = vid ? (vid.split("::").pop() ?? "") : "";
  const id = safeText(tail, 120).replace(/[^A-Za-z0-9._-]/g, "");
  return id ? `v:${id}` : `x:${crypto.randomUUID()}`;
}

export function clientIpOf(headers: Headers_): string | null {
  const fwd = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return cleanIp(headers.get("x-real-ip") ?? fwd ?? null);
}

function refererHost(v: string | null): string | null {
  if (!v) return null;
  try {
    return safeText(new URL(v).host, 120) || null;
  } catch {
    return null;
  }
}

export type SelfLogInput = {
  headers: Headers_;
  method: string;
  url: string;
  status?: number | null;
  bytesOut?: number | null;
  source: "middleware" | "app";
};

/** The row for a request, as stored in request_logs. */
export function selfLogRow(i: SelfLogInput) {
  let pathWithQuery = "/";
  try {
    const u = new URL(i.url);
    pathWithQuery = u.pathname + u.search;
  } catch {
    // keep "/"
  }
  // Passed on to an /api address that doesn't exist: Next answers 404, which the middleware can't see.
  let pathname = "/";
  try {
    pathname = new URL(i.url).pathname;
  } catch {
    // keep "/"
  }
  const unknownApi = i.source === "middleware" && i.status == null && isUnknownApi(pathname);
  const status = unknownApi ? 404 : (i.status ?? null);
  return {
    log_key: requestKey(i.headers),
    at: new Date().toISOString(),
    ip: clientIpOf(i.headers),
    method: safeText(i.method, 12).toUpperCase() || null,
    host: safeText(i.headers.get("host") ?? "", 120) || null,
    path: cleanPath(pathWithQuery),
    status,
    bytes_out: i.bytesOut ?? null,
    source: i.source,
    ua: safeText(i.headers.get("user-agent") ?? "", 300) || null,
    referer_host: refererHost(i.headers.get("referer")),
    region: safeText(i.headers.get("x-vercel-ip-country") ?? "", 20) || null,
    cache: null,
    waf_action: null,
    waf_rule: null,
    request_id: safeText(i.headers.get("x-vercel-id") ?? "", 120) || null,
    deployment_id: safeText(process.env.VERCEL_DEPLOYMENT_ID ?? "", 80) || null,
    probe: probeReason(pathWithQuery, status),
  };
}
