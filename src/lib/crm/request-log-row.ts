// The pieces of the site's own request log that need no network or framework: the row for a request and its key.
// Edge-safe; tested in request-log-write.test.ts.
import { cleanIp, cleanPath, probeReason, safeText } from "./request-logs.ts";

export type Headers_ = { get(name: string): string | null };

/** One row's key: Vercel's request id when there is one (it is on every request Vercel serves), else random. */
export function requestKey(headers: Headers_): string {
  const vid = headers.get("x-vercel-id");
  const id = vid ? safeText(vid, 120).replace(/[^A-Za-z0-9:._-]/g, "") : "";
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
  const status = i.status ?? null;
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
