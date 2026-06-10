import { NextResponse } from "next/server";

import { alertNewLead } from "@/lib/crm/notify";

// All quote submissions go through this server-side endpoint. The browser never
// writes to the database directly: we validate everything here and insert with
// the secret service-role key (server-only). Combined with RLS (which blocks the
// public anon key from reading or writing the table), your customer data can't
// be scraped or spammed straight from the client.

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
// Prefer the service-role key (bypasses RLS, table stays locked to the public).
// Fall back to anon only if a service key isn't configured.
const WRITE_KEY = SERVICE_KEY || ANON_KEY;
const CONFIGURED = Boolean(SUPABASE_URL && WRITE_KEY);

const LIMITS = {
  name: 120,
  phone: 32,
  email: 200,
  service: 120,
  address: 300,
  city: 120,
  details: 2000,
  preferred_time: 120,
  source_path: 300,
  files: 12,
  filePath: 300,
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const QUOTE_TYPES = new Set(["online", "inperson"]);

function asString(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

// Best-effort per-IP rate limit. Serverless instances are ephemeral, so this is
// a deterrent rather than a guarantee; the honeypot + validation do the rest.
const hits = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const max = 8;
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear(); // crude memory cap
  return recent.length > max;
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  // Honeypot: real users never see/fill this. Pretend success and drop it.
  if (asString(body.company, 100) !== "") {
    return NextResponse.json({ ok: true });
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  if (rateLimited(ip)) {
    return NextResponse.json({ ok: false, error: "Too many requests. Please call us." }, { status: 429 });
  }

  // ── Validate ──
  const name = asString(body.name, LIMITS.name);
  const phoneRaw = asString(body.phone, LIMITS.phone);
  const phoneDigits = phoneRaw.replace(/\D/g, "");
  const email = asString(body.email, LIMITS.email);
  const service = asString(body.service, LIMITS.service);
  const address = asString(body.address, LIMITS.address);
  const city = asString(body.city, LIMITS.city);
  const details = asString(body.details, LIMITS.details);
  const quoteType = asString(body.quote_type, 16);
  const preferredTime = asString(body.preferred_time, LIMITS.preferred_time);
  const sourcePath = asString(body.source_path, LIMITS.source_path);

  const errors: string[] = [];
  if (name.length < 2) errors.push("name");
  if (!(phoneDigits.length === 10 || (phoneDigits.length === 11 && phoneDigits.startsWith("1")))) errors.push("phone");
  if (email && !EMAIL_RE.test(email)) errors.push("email");
  if (address.length < 5 || !/\d/.test(address)) errors.push("address");
  if (quoteType && !QUOTE_TYPES.has(quoteType)) errors.push("quote_type");

  // file_urls: only accept paths we created in our own bucket.
  let fileUrls: string[] | null = null;
  if (Array.isArray(body.file_urls)) {
    const cleaned = body.file_urls
      .filter((p): p is string => typeof p === "string")
      .map((p) => p.trim().slice(0, LIMITS.filePath))
      .filter((p) => p.startsWith("quote-uploads/"))
      .slice(0, LIMITS.files);
    fileUrls = cleaned.length ? cleaned : null;
  }

  if (errors.length) {
    return NextResponse.json({ ok: false, error: "Please check your details.", fields: errors }, { status: 422 });
  }

  if (!CONFIGURED) {
    // No keys configured (e.g. preview without env) — accept but don't persist.
    return NextResponse.json({ ok: true, demo: true });
  }

  const row = {
    name,
    phone: phoneRaw,
    email: email || null,
    service: service || null,
    address,
    city: city || null,
    details: details || null,
    quote_type: QUOTE_TYPES.has(quoteType) ? quoteType : null,
    preferred_time: quoteType === "inperson" ? preferredTime || null : null,
    file_urls: fileUrls,
    source_path: sourcePath || null,
  };

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/quote_requests`, {
      method: "POST",
      headers: {
        apikey: WRITE_KEY,
        Authorization: `Bearer ${WRITE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(row),
    });
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: "Could not save. Please call us." }, { status: 502 });
    }

    // Text the owner about the new lead (best-effort; never blocks the response).
    const created = (await res.json().catch(() => [])) as Array<{ job_token?: string }>;
    const jobToken = created[0]?.job_token;
    if (jobToken) {
      await alertNewLead({
        name,
        phone: phoneRaw,
        service,
        city,
        quote_type: row.quote_type ?? undefined,
        job_token: jobToken,
      }).catch(() => {});
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "Could not save. Please call us." }, { status: 502 });
  }
}
