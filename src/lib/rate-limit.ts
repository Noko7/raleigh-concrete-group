// Shared rate limiter usable from both edge middleware and Node route handlers.
// Dependency-free: if Upstash Redis REST credentials are present it uses a
// durable, cross-instance fixed-window counter; otherwise it falls back to a
// best-effort in-memory counter (per serverless instance). Configure in Vercel:
//   UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL || "";
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || "";

// Trusted client IP. On Vercel, `x-real-ip` is set by the platform to the
// connecting client and is NOT spoofable by the client, unlike the left-most
// `x-forwarded-for` entry. We fall back to the RIGHT-most XFF hop (the address
// the edge actually saw) before giving up.
export function clientIp(request: Request): string {
  const h = request.headers;
  const realIp = h.get("x-real-ip");
  if (realIp) return realIp.trim();
  const xff = h.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return "unknown";
}

const mem = new Map<string, number[]>();

function memLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (mem.get(key) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  mem.set(key, recent);
  if (mem.size > 8000) mem.clear();
  return recent.length > max;
}

async function upstashLimited(key: string, max: number, windowMs: number): Promise<boolean | null> {
  try {
    const bucket = Math.floor(Date.now() / windowMs);
    const k = `rl:${key}:${bucket}`;
    const ttl = Math.ceil(windowMs / 1000);
    const res = await fetch(`${UPSTASH_URL}/pipeline`, {
      method: "POST",
      cache: "no-store",
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify([
        ["INCR", k],
        ["EXPIRE", k, ttl, "NX"],
      ]),
    });
    if (!res.ok) return null;
    const out = (await res.json()) as Array<{ result?: number }>;
    const count = out?.[0]?.result ?? 0;
    return count > max;
  } catch {
    return null;
  }
}

// Returns true when the caller has EXCEEDED `max` requests in the window.
export async function rateLimit(key: string, max: number, windowMs: number): Promise<boolean> {
  if (UPSTASH_URL && UPSTASH_TOKEN) {
    const durable = await upstashLimited(key, max, windowMs);
    if (durable !== null) return durable;
  }
  return memLimited(key, max, windowMs);
}
