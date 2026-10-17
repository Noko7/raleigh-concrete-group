// Works in edge middleware and Node routes. Uses Upstash Redis REST (durable, cross-instance fixed window)
// when UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are set; otherwise a per-instance in-memory counter.
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL || "";
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || "";

// On Vercel `x-real-ip` is set by the platform and not client-spoofable, unlike the left-most
// `x-forwarded-for`. Fallback: the RIGHT-most XFF hop (what the edge saw).
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

const MEM_MAX_KEYS = 8000;
const mem = new Map<string, number[]>();

function memLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (mem.get(key) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  // Re-set so the key moves to the end of insertion order, making eviction oldest-first.
  mem.delete(key);
  mem.set(key, recent);

  if (mem.size > MEM_MAX_KEYS) {
    // Evict the oldest tenth, NOT the whole table: clearing it would let anyone flood junk keys to wipe the
    // counter that is limiting them.
    const evict = Math.ceil(MEM_MAX_KEYS / 10);
    let n = 0;
    for (const k of mem.keys()) {
      if (n++ >= evict) break;
      if (k !== key) mem.delete(k);
    }
  }

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

// True when the caller has EXCEEDED `max` in the window.
export async function rateLimit(key: string, max: number, windowMs: number): Promise<boolean> {
  if (UPSTASH_URL && UPSTASH_TOKEN) {
    const durable = await upstashLimited(key, max, windowMs);
    if (durable !== null) return durable;
  }
  return memLimited(key, max, windowMs);
}
