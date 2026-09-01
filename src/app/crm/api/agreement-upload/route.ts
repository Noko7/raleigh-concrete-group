import { NextResponse } from "next/server";

import { getSession } from "@/lib/crm/auth";
import { AGREEMENT_BUCKET, SUPABASE_URL, SERVICE_KEY } from "@/lib/crm/env";

// Owner-only: issues a short-lived, single-object signed upload URL for the
// private agreements bucket. Same shape as the public /api/upload-url route,
// but gated on an owner session - contractors never upload contracts, they
// sign them in DocuSeal.
//
// The object name is server-generated, so there is no client-supplied path
// component to traverse with.
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/webp",
]);
const EXT_RE = /^[a-z0-9]{1,5}$/;

export async function POST(request: Request) {
  const session = await getSession();
  if (!session || session.staff.role !== "owner") {
    return NextResponse.json({ ok: false, error: "Owners only." }, { status: 403 });
  }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return NextResponse.json({ ok: false, error: "Uploads are not configured." }, { status: 503 });
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
    return NextResponse.json({ ok: false, error: "Upload a PDF or an image." }, { status: 400 });
  }

  const obj = `${Date.now()}-${crypto.randomUUID()}.${ext}`;

  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/upload/sign/${AGREEMENT_BUCKET}/${obj}`, {
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
    path: `${AGREEMENT_BUCKET}/${obj}`,
    uploadUrl: `${SUPABASE_URL}/storage/v1${json.url}`,
  });
}
