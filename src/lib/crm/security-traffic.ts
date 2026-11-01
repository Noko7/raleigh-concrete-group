// Server-only: the website's traffic for the owner's security page, from request_logs (filled by the Vercel Log
// Drain at /api/logs/vercel). One call to security_traffic(), which only the service role may run; the page
// checks the owner before calling this.
import { pgAdmin } from "./rest";
import { WINDOWS, type WindowKey } from "./request-logs";

export type IpStat = {
  ip: string;
  requests: number;
  bytes: number;
  c4xx: number;
  c5xx: number;
  probes: number;
  paths: number;
  first_seen: string;
  last_seen: string;
  top_path: string | null;
  ua: string | null;
};

export type Traffic = {
  totals: { requests: number; bytes: number; ips: number; c4xx: number; c5xx: number; waf: number; probes: number; first: string | null; last: string | null };
  last_received: string | null;
  series: { bucket: string; requests: number; bytes: number; errors: number }[];
  median_ip_bytes: number;
  by_bytes: IpStat[];
  by_requests: IpStat[];
  by_errors: IpStat[];
  by_paths: IpStat[];
  probes: { ip: string; hits: number; kinds: string[]; examples: string[]; last_seen: string; ua: string | null }[];
  largest: { at: string; ip: string | null; method: string | null; path: string; status: number | null; bytes_out: number; ua: string | null }[];
  routes: { route: string; requests: number; bytes: number; ips: number; biggest: number | null }[];
  statuses: Record<string, number>;
};

/** The window's traffic, or null when the log can't be read (table missing, database down). */
export async function loadTraffic(window: WindowKey): Promise<Traffic | null> {
  const since = new Date(Date.now() - WINDOWS[window] * 86_400_000).toISOString();
  try {
    const res = await pgAdmin("rpc/security_traffic", { method: "POST", body: JSON.stringify({ p_since: since }) });
    if (!res.ok) {
      console.error("[security] security_traffic failed", res.status);
      return null;
    }
    return (await res.json()) as Traffic;
  } catch (e) {
    console.error("[security] security_traffic failed", (e as Error).message);
    return null;
  }
}

/** Whether the drain is configured on this deployment (the secret is set). */
export const drainConfigured = () => Boolean(process.env.VERCEL_LOG_DRAIN_SECRET);
