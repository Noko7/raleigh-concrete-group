import { NextResponse } from "next/server";

import { clientIp, rateLimit } from "@/lib/rate-limit";

// Short-lived single-object signed upload URL for quote-uploads. The browser has no anon write access:
// every upload is authorized here (rate-limited, type-checked).
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const BUCKET = "quote-uploads";

// Keep in sync with the bucket's allowed_mime_types in supabase/schema.sql.
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
  "image/gif",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/3gpp",
]);
const EXT_RE = /^[a-z0-9]{1,5}$/;

export async function POST(request: Request) {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return NextResponse.json({ ok: false, error: "Uploads are not configured." }, { status: 503 });
  }

  // Deter storage abuse (cost, quota).
  const ip = clientIp(request);
  if (await rateLimit(`upload:${ip}`, 40, 10 * 60 * 1000)) {
    return NextResponse.json({ ok: false, error: "Too many uploads. Please try again later." }, { status: 429 });
  }

  let body: { ext?: unknown; contentType?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const ext = typeof body.ext === "string" ? body.ext.toLowerCase().replace(/[^a-z0-9]/g, "") : "";
  const contentType = typeof body.contentType === "string" ? body.contentType : "";
  if (!EXT_RE.test(ext) || !ALLOWED_TYPES.has(contentType)) {
    return NextResponse.json({ ok: false, error: "Unsupported file type." }, { status: 400 });
  }

  // Server-named object: nothing to traverse with.
  const obj = `${Date.now()}-${crypto.randomUUID()}.${ext}`;

  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/upload/sign/${BUCKET}/${obj}`, {
    method: "POST",
    cache: "no-store",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    return NextResponse.json({ ok: false, error: "Could not start upload." }, { status: 502 });
  }
  const json = (await res.json().catch(() => ({}))) as { url?: string };
  if (!json.url) {
    return NextResponse.json({ ok: false, error: "Could not start upload." }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    path: `${BUCKET}/${obj}`,
    uploadUrl: `${SUPABASE_URL}/storage/v1${json.url}`,
  });
}
