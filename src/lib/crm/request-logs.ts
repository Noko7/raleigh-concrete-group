// Vercel's request logs (a Log Drain posting to /api/logs/vercel), reduced to one row per request for the
// owner's security page: who asked for what, what came back, and how many bytes went out. Pure (no network), so
// the signature check, the parsing, the path clean-up and the anomaly rules are tested (request-logs.test.ts).
//
// Vercel sends a JSON array, NDJSON or a single object (https://vercel.com/docs/drains/reference/logs). A
// request can produce several lines (each console.log of a function carries the same `proxy` block), so rows are
// keyed by requestId and stored once. Lines without a `proxy` block (build output) aren't requests and are
// skipped, as is anything malformed: one bad line never costs the batch.
//
// No Node-only imports: the middleware (Edge) uses cleanPath/cleanIp/probeReason to log each request itself
// (request-log-write.ts). The drain's signature check lives in request-log-signature.ts.

/** The drain endpoint itself: its own deliveries are not traffic worth watching. */
export const DRAIN_PATH = "/api/logs/vercel";

/** Every log object in a drain body: a JSON array, one JSON object, or NDJSON. Unparseable lines are dropped. */
export function parseDrainBody(raw: string): unknown[] {
  const text = raw.trim();
  if (!text) return [];
  if (text.startsWith("[")) {
    try {
      const v = JSON.parse(text) as unknown;
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }
  const out: unknown[] = [];
  for (const line of text.split(/\r?\n/)) {
    const l = line.trim();
    if (!l) continue;
    try {
      out.push(JSON.parse(l));
    } catch {
      // skipped
    }
  }
  return out;
}

export type RequestRow = {
  log_key: string;
  at: string;
  ip: string | null;
  method: string | null;
  host: string | null;
  path: string;
  status: number | null;
  bytes_out: number | null;
  source: string | null;
  ua: string | null;
  referer_host: string | null;
  region: string | null;
  cache: string | null;
  waf_action: string | null;
  waf_rule: string | null;
  request_id: string | null;
  deployment_id: string | null;
  probe: string | null;
};

/**
 * Text Postgres will always accept: no control characters (a NUL is refused outright), no lone surrogate halves,
 * and cut by code point so an emoji is never split in two. Attackers choose these strings, and a single row the
 * database refuses would otherwise fail the whole delivery.
 */
export function safeText(s: string, max: number): string {
  const cleaned = s
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "");
  return Array.from(cleaned).slice(0, max).join("");
}

const str = (v: unknown, max: number): string | null => {
  if (Array.isArray(v)) v = v.find((x) => typeof x === "string");
  if (typeof v !== "string") return null;
  const s = safeText(v.trim(), max).trim();
  return s || null;
};

/** The longest path stored; the table allows 520. */
export const MAX_STORED_PATH = 500;
const num = (v: unknown): number | null => {
  const n = typeof v === "string" && v.trim() ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
};

const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6 = /^[0-9a-f:.]{2,45}$/i;
export function cleanIp(v: unknown): string | null {
  const s = str(v, 64);
  if (!s) return null;
  const first = s.split(",")[0].trim();
  return IPV4.test(first) || (first.includes(":") && IPV6.test(first)) ? first.toLowerCase() : null;
}

// Capability links (quote, pay, receipt, signing, job and invite tokens) and long ids are masked: the security log
// must never become a list of working links.
// Hyphenated words (page slugs like "stamped-concrete-patios") are left alone.
const LONG_ID = /^(?:[0-9a-f]{16,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|(?=[A-Za-z_]*\d)[A-Za-z0-9_]{24,})$/i;

/**
 * The path as stored: no query values (only their names, which is where scanners show themselves), long ids and
 * tokens masked as ":id", capped. "/q/ab12...?preview=1" becomes "/q/:id?preview".
 */
export function cleanPath(raw: unknown): string {
  let s = str(raw, 2000) ?? "/";
  try {
    if (/^https?:\/\//i.test(s)) s = new URL(s).pathname + new URL(s).search;
  } catch {
    // keep as is
  }
  const q = s.indexOf("?");
  const pathPart = q >= 0 ? s.slice(0, q) : s;
  const query = q >= 0 ? s.slice(q + 1) : "";
  const path = pathPart
    .split("/")
    .map((seg) => (LONG_ID.test(seg) ? ":id" : seg))
    .join("/");
  const keys = query
    ? [...new Set(query.split("&").map((kv) => safeText(decodeSafe(kv.split("=")[0]), 40)).filter(Boolean))].slice(0, 8)
    : [];
  return safeText((path || "/").slice(0, 400) + (keys.length ? `?${keys.join("&")}` : ""), MAX_STORED_PATH) || "/";
}

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return s;
  }
}

// Paths this site never serves that scanners ask for, and payloads that only show up in attacks. Checked on the
// full raw path (query included) before it is cleaned, so an injection attempt in a query value still counts.
const PROBES: [string, RegExp][] = [
  ["wordpress", /\/(wp-admin|wp-login\.php|wp-content|wp-includes|xmlrpc\.php|wp-json)\b/i],
  ["dotfile", /\/\.(env|git|svn|hg|aws|ssh|htaccess|htpasswd|ds_store|vscode|idea|npmrc|docker)/i],
  ["traversal", /(\.\.\/|\.\.\\|%2e%2e|%252e|\/etc\/passwd|\/proc\/self|c:\\windows)/i],
  // Only shapes that don't occur in normal text ("select colors from menu" is a search, not an attack).
  ["sql", /(union(\s|%20|\+)+(all(\s|%20|\+)+)?select|'\s*or\s*'?1'?\s*=\s*'?1|sleep\(\d|benchmark\(|information_schema|;--|%27%20or|or%201=1|pg_sleep|waitfor(\s|%20|\+)+delay)/i],
  ["script", /(<script|%3cscript|javascript:|onerror=|\$\{jndi:|%24%7bjndi)/i],
  ["admin-panel", /\/(phpmyadmin|pma|myadmin|adminer|cpanel|webmail|manager\/html|actuator|solr|jenkins|boaform|hnap1|cgi-bin|server-status)\b/i],
  ["php", /\.(php\d?|asp|aspx|jsp|cgi|pl)(\?|$|\/)/i],
  ["backup-file", /\.(bak|sql|tar|tgz|zip|7z|rar|old|swp|db|sqlite)(\?|$)/i],
  ["admin", /^\/(admin|administrator|login\.php|user\/login|backend|console)(\/|\?|$)/i],
];

/** Why a request looks like probing, or null. A 404 on /api/* is someone guessing at endpoints. */
export function probeReason(rawPath: unknown, status: number | null): string | null {
  const s = str(rawPath, 4000) ?? "";
  const lower = s.toLowerCase();
  for (const [why, re] of PROBES) {
    if (!(re.test(lower) || re.test(decodeSafe(lower)))) continue;
    // Asking for an archive or database file only counts when it isn't there: a real download isn't a probe.
    if (why === "backup-file" && status !== null && status < 400) continue;
    return why;
  }
  const path = lower.split("?")[0];
  if (status === 404 && path.startsWith("/api/")) return "api-guess";
  if (status === 405 && path.startsWith("/api/")) return "api-method";
  return null;
}

function refererHost(v: unknown): string | null {
  const s = str(v, 500);
  if (!s) return null;
  try {
    return new URL(s).host.slice(0, 120) || null;
  } catch {
    return null;
  }
}

/** One stored row from one drain line, or null when the line isn't a request (or is the drain's own delivery). */
export function toRequestRow(line: unknown): RequestRow | null {
  if (!line || typeof line !== "object") return null;
  const l = line as Record<string, unknown>;
  const p = (l.proxy && typeof l.proxy === "object" ? l.proxy : null) as Record<string, unknown> | null;
  if (!p) return null;
  const rawPath = p.path ?? l.path;
  const path = cleanPath(rawPath);
  const status = num(p.statusCode ?? l.statusCode);
  // The drain's own accepted deliveries are skipped (logging them would log forever); anything refused there,
  // such as a forged post that got a 403, is kept so attacks on the endpoint show up.
  if ((path === DRAIN_PATH || path.startsWith(`${DRAIN_PATH}?`)) && status !== null && status < 300) return null;
  const ts = num(p.timestamp) ?? num(l.timestamp);
  if (!ts) return null;
  const at = new Date(ts);
  if (Number.isNaN(at.getTime())) return null;
  const requestId = str(l.requestId ?? p.requestId, 120);
  const id = str(l.id, 120);
  if (!requestId && !id) return null;
  return {
    log_key: requestId ? `r:${requestId}` : `l:${id}`,
    at: at.toISOString(),
    ip: cleanIp(p.clientIp),
    method: str(p.method, 12)?.toUpperCase() ?? null,
    host: str(p.host ?? l.host, 120),
    path,
    status,
    bytes_out: num(p.responseByteSize ?? p.bytesSent ?? p.responseBytes),
    source: str(l.source, 20),
    ua: str(p.userAgent, 300),
    referer_host: refererHost(p.referer),
    region: str(p.region ?? l.executionRegion, 20),
    cache: str(p.vercelCache, 20),
    waf_action: str(p.wafAction, 40),
    waf_rule: str(p.wafRuleId, 80),
    request_id: requestId,
    deployment_id: str(l.deploymentId, 80),
    probe: probeReason(rawPath, status),
  };
}

/** One row per request in a batch: the line with the most detail (largest byte count) wins. */
export function rowsFromDrain(lines: unknown[]): RequestRow[] {
  const byKey = new Map<string, RequestRow>();
  for (const line of lines) {
    const row = toRequestRow(line);
    if (!row) continue;
    const prev = byKey.get(row.log_key);
    if (!prev || (row.bytes_out ?? -1) > (prev.bytes_out ?? -1)) byKey.set(row.log_key, row);
  }
  return [...byKey.values()];
}

// ── Reading it back ────────────────────────────────────────────────────────

export const WINDOWS = { "24h": 1, "7d": 7, "30d": 30 } as const;
export type WindowKey = keyof typeof WINDOWS;
export const isWindow = (v: unknown): v is WindowKey => typeof v === "string" && Object.hasOwn(WINDOWS, v);

export const GB = 1024 ** 3;

/** Why an IP's data out stands out, if it does: a lot in absolute terms, a lot next to everyone else, or most of it. */
export function anomalyReasons(ipBytes: number, medianBytes: number, totalBytes: number): string[] {
  const out: string[] = [];
  if (ipBytes >= GB) out.push("over 1 GB");
  if (medianBytes > 0 && ipBytes >= 10 * medianBytes && ipBytes >= 5 * 1024 ** 2) out.push(`${Math.round(ipBytes / medianBytes)}x the typical visitor`);
  if (totalBytes > 0 && ipBytes / totalBytes > 0.5 && ipBytes >= 5 * 1024 ** 2) out.push("over half of all data out");
  return out;
}

export function formatBytes(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v) || v <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let x = v;
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024;
    i++;
  }
  return `${x >= 100 || i === 0 ? Math.round(x) : x.toFixed(1)} ${units[i]}`;
}

/** The median of a list (0 when empty). */
export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
