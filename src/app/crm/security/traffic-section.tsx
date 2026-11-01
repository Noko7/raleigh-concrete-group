import Link from "next/link";

import { BUSINESS_TZ } from "@/lib/crm/clock";
import { anomalyReasons, formatBytes, WINDOWS, type WindowKey } from "@/lib/crm/request-logs";
import type { IpStat, Traffic } from "@/lib/crm/security-traffic";

// The website's traffic, from Vercel's request logs: how much went out and to whom, who is hammering the site,
// and who is poking at paths that don't exist. Server-rendered; the window is a link (?window=24h|7d|30d).

const WINDOW_LABEL: Record<WindowKey, string> = { "24h": "Last 24 hours", "7d": "Last 7 days", "30d": "Last 30 days" };

const PROBE_LABEL: Record<string, string> = {
  wordpress: "WordPress scan",
  dotfile: "Hidden file (.env, .git)",
  traversal: "Path traversal",
  sql: "SQL injection",
  script: "Script injection",
  "admin-panel": "Admin panel scan",
  php: "PHP / ASP page",
  "backup-file": "Backup / database file",
  admin: "Admin login guess",
  "api-guess": "Unknown API endpoint",
  "api-method": "Wrong method on API",
};

function when(iso: string | null | undefined): string {
  if (!iso) return "N/A";
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: BUSINESS_TZ });
}

function shortUa(ua: string | null | undefined): string {
  if (!ua) return "No user agent";
  if (/bot|crawl|spider|slurp|curl|wget|python|go-http|java|scanner|zgrab|masscan|nmap|httpclient|headless/i.test(ua)) {
    const m = ua.match(/([A-Za-z-]*(bot|crawler|spider|curl|wget|python-requests|python|go-http-client|zgrab|masscan|nmap|HeadlessChrome)[A-Za-z0-9./-]*)/i);
    return m ? m[1].slice(0, 40) : ua.slice(0, 40);
  }
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : "Other";
  return `${browser}${/Mobile|Android|iPhone|iPad/i.test(ua) ? " · Mobile" : ""}`;
}

/** Hours for a day, days for a week or month: enough bars to read, not so many they blur. */
function bars(t: Traffic, range: WindowKey): { label: string; bytes: number; requests: number; errors: number }[] {
  const byDay = range !== "24h";
  const map = new Map<string, { label: string; bytes: number; requests: number; errors: number }>();
  for (const s of t.series) {
    const d = new Date(s.bucket);
    const key = byDay ? d.toLocaleDateString("en-CA", { timeZone: BUSINESS_TZ }) : s.bucket;
    const label = byDay
      ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: BUSINESS_TZ })
      : d.toLocaleTimeString("en-US", { hour: "numeric", timeZone: BUSINESS_TZ });
    const b = map.get(key) ?? { label, bytes: 0, requests: 0, errors: 0 };
    b.bytes += Number(s.bytes) || 0;
    b.requests += Number(s.requests) || 0;
    b.errors += Number(s.errors) || 0;
    map.set(key, b);
  }
  return [...map.values()];
}

function IpTable({ rows, show, total, median }: { rows: IpStat[]; show: "bytes" | "requests" | "errors" | "paths"; total: number; median: number }) {
  if (rows.length === 0) return <p className="crm-muted crm-sm">Nothing in this window.</p>;
  return (
    <div className="crm-table-wrap">
      <table className="crm-table sec-traffic-table">
        <thead>
          <tr>
            <th>IP</th>
            <th>Data out</th>
            {show === "bytes" && <th>Share</th>}
            <th>Requests</th>
            <th>4xx / 5xx</th>
            <th>Paths</th>
            <th>Most asked for</th>
            <th>Client</th>
            <th>Seen</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const flags = show === "bytes" ? anomalyReasons(Number(r.bytes), median, total) : [];
            return (
              <tr key={r.ip} className={flags.length ? "sec-row-flag" : undefined}>
                <td className="sec-ipcell">
                  <span className="sec-mono">{r.ip}</span>
                  {(flags.length > 0 || r.probes > 0) && (
                    <span className="sec-flags">
                      {flags.map((f) => (
                        <span key={f} className="crm-badge crm-badge-danger">
                          {f}
                        </span>
                      ))}
                      {r.probes > 0 && <span className="crm-badge crm-badge-lost">{r.probes} probes</span>}
                    </span>
                  )}
                </td>
                <td className={show === "bytes" ? "sec-strong" : undefined}>{formatBytes(Number(r.bytes))}</td>
                {show === "bytes" && <td className="crm-sm">{total > 0 ? `${((Number(r.bytes) / total) * 100).toFixed(1)}%` : "0%"}</td>}
                <td className={show === "requests" ? "sec-strong" : undefined}>{Number(r.requests).toLocaleString()}</td>
                <td className={show === "errors" ? "sec-strong" : r.c4xx + r.c5xx > 0 ? "sec-failed" : undefined}>
                  {r.c4xx} / {r.c5xx}
                </td>
                <td className={show === "paths" ? "sec-strong" : undefined}>{r.paths}</td>
                <td className="crm-sm sec-mono sec-path">{r.top_path ?? "N/A"}</td>
                <td className="crm-sm crm-muted">{shortUa(r.ua)}</td>
                <td className="crm-sm crm-muted">
                  {when(r.first_seen)} to {when(r.last_seen)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function TrafficSection({ traffic, range, base, configured }: { traffic: Traffic | null; range: WindowKey; base: string; configured: boolean }) {
  const t = traffic;
  const total = Number(t?.totals.bytes ?? 0);
  const median = Number(t?.median_ip_bytes ?? 0);
  const empty = !t || !t.last_received;
  const flagged = (t?.by_bytes ?? []).filter((r) => anomalyReasons(Number(r.bytes), median, total).length > 0);
  const series = t ? bars(t, range) : [];
  const maxBytes = Math.max(1, ...series.map((s) => s.bytes));
  const stale = t?.last_received ? Date.now() - new Date(t.last_received).getTime() > 6 * 3_600_000 : false;

  return (
    <section aria-label="Website traffic" className="sec-traffic">
      <div className="sec-traffic-head">
        <h2 className="crm-card-title">Website traffic</h2>
        <nav className="sec-windows" aria-label="Time window">
          {(Object.keys(WINDOWS) as WindowKey[]).map((w) => (
            <Link key={w} href={`${base}/security?window=${w}`} className={w === range ? "sec-window sec-window-on" : "sec-window"} aria-current={w === range ? "page" : undefined}>
              {w}
            </Link>
          ))}
        </nav>
      </div>

      {!t && configured && <div className="crm-alert">The request log couldn&apos;t be read just now. Refresh in a minute.</div>}

      {empty ? (
        <div className="crm-card">
          <h3 className="sec-h3">Connect Vercel&apos;s request logs</h3>
          <p className="crm-sm">
            Nothing has arrived yet. Every request to the website (who, what, and how much data went back) comes from a
            Vercel Log Drain. To turn it on:
          </p>
          <ol className="crm-sm sec-steps">
            <li>In Vercel, open the project, then Settings, then Drains (Log Drains), and add a drain.</li>
            <li>
              Data: <strong>Logs</strong>. Sources: static, lambda, edge, external and firewall. Environment: production.
            </li>
            <li>
              Endpoint: <code>https://raleighconcrete.net/api/logs/vercel</code>, format JSON.
            </li>
            <li>
              Copy the drain&apos;s signature secret into the project&apos;s environment variables as{" "}
              <code>VERCEL_LOG_DRAIN_SECRET</code> (Production), then redeploy.
              {configured ? " (Already set on this deployment.)" : " (Not set on this deployment yet.)"}
            </li>
          </ol>
          <p className="crm-muted crm-sm">One drain is all this needs. Requests show up here within a minute or two of being served.</p>
        </div>
      ) : (
        <>
          {stale && (
            <div className="crm-alert">
              No new requests have arrived since {when(t.last_received)}. Check the drain in Vercel (Settings, Drains).
            </div>
          )}
          {flagged.length > 0 && (
            <div className="crm-alert">
              <strong>Unusual data out:</strong>{" "}
              {flagged.map((r) => `${r.ip} (${formatBytes(Number(r.bytes))})`).join(", ")}. Check what they downloaded below.
            </div>
          )}

          <div className="crm-stats">
            <div className="crm-stat">
              <strong>{formatBytes(total)}</strong>
              <span>Data out</span>
            </div>
            <div className="crm-stat">
              <strong>{Number(t.totals.requests).toLocaleString()}</strong>
              <span>Requests</span>
            </div>
            <div className="crm-stat">
              <strong>{Number(t.totals.ips).toLocaleString()}</strong>
              <span>Distinct IPs</span>
            </div>
            <div className="crm-stat">
              <strong>{Number(t.totals.c4xx).toLocaleString()}</strong>
              <span>Client errors (4xx)</span>
            </div>
            <div className="crm-stat">
              <strong>{Number(t.totals.c5xx).toLocaleString()}</strong>
              <span>Server errors (5xx)</span>
            </div>
            <div className="crm-stat">
              <strong>{Number(t.totals.probes).toLocaleString()}</strong>
              <span>Probing requests</span>
            </div>
            <div className="crm-stat">
              <strong>{Number(t.totals.waf).toLocaleString()}</strong>
              <span>Firewall actions</span>
            </div>
          </div>

          <div className="crm-card">
            <h3 className="sec-h3">Data out, {WINDOW_LABEL[range].toLowerCase()}</h3>
            <div className="sec-chart" role="img" aria-label={`Data sent by the website per ${range === "24h" ? "hour" : "day"}`}>
              {series.map((s) => (
                <div key={s.label} className="sec-bar-col" title={`${s.label}: ${formatBytes(s.bytes)}, ${s.requests.toLocaleString()} requests, ${s.errors} errors`}>
                  <div className="sec-bar" style={{ height: `${Math.max(2, (s.bytes / maxBytes) * 100)}%` }} />
                </div>
              ))}
            </div>
            <div className="sec-chart-axis crm-muted crm-sm">
              <span>{series[0]?.label ?? ""}</span>
              <span>Peak {formatBytes(maxBytes)}</span>
              <span>{series[series.length - 1]?.label ?? ""}</span>
            </div>
          </div>

          <div className="crm-card">
            <h3 className="sec-h3">Data out by IP</h3>
            <p className="crm-muted crm-sm">
              The 20 addresses the site sent the most data to. Flagged: over 1 GB, over 10 times a typical visitor
              ({formatBytes(median)}), or more than half of everything sent.
            </p>
            <IpTable rows={t.by_bytes} show="bytes" total={total} median={median} />
          </div>

          <div className="crm-card">
            <h3 className="sec-h3">Probing and arbitrary requests</h3>
            <p className="crm-muted crm-sm">Requests for things this site doesn&apos;t have: WordPress pages, .env files, admin panels, injection attempts, made-up API routes.</p>
            {t.probes.length === 0 ? (
              <p className="crm-muted crm-sm">None in this window.</p>
            ) : (
              <div className="crm-table-wrap">
                <table className="crm-table sec-traffic-table">
                  <thead>
                    <tr>
                      <th>IP</th>
                      <th>Hits</th>
                      <th>What they tried</th>
                      <th>Examples</th>
                      <th>Client</th>
                      <th>Last seen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.probes.map((p) => (
                      <tr key={p.ip}>
                        <td className="sec-mono">{p.ip}</td>
                        <td className="sec-strong">{Number(p.hits).toLocaleString()}</td>
                        <td className="crm-sm">{p.kinds.map((k) => PROBE_LABEL[k] ?? k).join(", ")}</td>
                        <td className="crm-sm sec-mono sec-path">{p.examples.join("  ")}</td>
                        <td className="crm-sm crm-muted">{shortUa(p.ua)}</td>
                        <td className="crm-sm crm-muted">{when(p.last_seen)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="crm-card">
            <h3 className="sec-h3">Noisiest IPs</h3>
            <p className="crm-muted crm-sm">Most requests</p>
            <IpTable rows={t.by_requests} show="requests" total={total} median={median} />
            <p className="crm-muted crm-sm sec-sub">Most errors (requests the site refused or failed)</p>
            <IpTable rows={t.by_errors} show="errors" total={total} median={median} />
            <p className="crm-muted crm-sm sec-sub">Most different paths (crawlers and scanners)</p>
            <IpTable rows={t.by_paths} show="paths" total={total} median={median} />
          </div>

          <div className="crm-card">
            <h3 className="sec-h3">Where the data went</h3>
            <p className="crm-muted crm-sm">By part of the site. Customer data leaves through /api, /crm, /q, /pay, /r and /sign, so watch those.</p>
            <div className="crm-table-wrap">
              <table className="crm-table sec-traffic-table">
                <thead>
                  <tr>
                    <th>Route</th>
                    <th>Data out</th>
                    <th>Requests</th>
                    <th>IPs</th>
                    <th>Largest single response</th>
                  </tr>
                </thead>
                <tbody>
                  {t.routes.map((r) => (
                    <tr key={r.route}>
                      <td className="sec-mono">{r.route || "/"}</td>
                      <td className="sec-strong">{formatBytes(Number(r.bytes))}</td>
                      <td>{Number(r.requests).toLocaleString()}</td>
                      <td>{Number(r.ips).toLocaleString()}</td>
                      <td>{formatBytes(Number(r.biggest ?? 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="crm-muted crm-sm sec-sub">Largest single responses</p>
            <div className="crm-table-wrap">
              <table className="crm-table sec-traffic-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>IP</th>
                    <th>Request</th>
                    <th>Status</th>
                    <th>Size</th>
                    <th>Client</th>
                  </tr>
                </thead>
                <tbody>
                  {t.largest.map((r, i) => (
                    <tr key={`${r.at}-${i}`}>
                      <td className="crm-sm">{when(r.at)}</td>
                      <td className="sec-mono">{r.ip ?? "N/A"}</td>
                      <td className="crm-sm sec-mono sec-path">
                        {r.method ?? ""} {r.path}
                      </td>
                      <td>{r.status ?? "N/A"}</td>
                      <td className="sec-strong">{formatBytes(Number(r.bytes_out))}</td>
                      <td className="crm-sm crm-muted">{shortUa(r.ua)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <p className="crm-muted crm-sm sec-limits">
        What this covers: every request the website served through Vercel, kept 30 days. Links that carry a customer
        token are stored masked (:id) and query values are dropped. It can&apos;t see someone using a leaked database
        key directly against Supabase: that traffic never passes through the website and shows only in Supabase&apos;s
        own logs. Vercel reports the size of what the site sends back, not uploads or network packets, so &quot;data
        out&quot; is response size per request.
      </p>
    </section>
  );
}
