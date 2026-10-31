import { NextResponse } from "next/server";

import { handleDocusealEvent } from "@/lib/crm/agreement-signing";
import { DOCUSEAL_WEBHOOK_SECRET } from "@/lib/crm/docuseal";
import { parseEvent, verifyDocusealSignature } from "@/lib/crm/docuseal-core";

export const dynamic = "force-dynamic";

// DocuSeal's webhooks (form.completed, form.declined, submission.completed, submission.expired, ...). Each is
// checked against DOCUSEAL_WEBHOOK_SECRET before anything is read from it, stored once, then acted on. A 2xx tells
// DocuSeal it arrived; a 5xx makes it retry (for up to 48 hours), which is what we want if storing it failed.
export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > 2_000_000) return new NextResponse("Too large", { status: 413 });
  const check = verifyDocusealSignature({
    secret: DOCUSEAL_WEBHOOK_SECRET,
    rawBody: raw,
    header: request.headers.get("x-docuseal-signature"),
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  if (!check.ok) {
    console.warn("[docuseal-webhook] refused:", check.reason);
    return new NextResponse("Unauthorized", { status: 401 });
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return new NextResponse("Bad request", { status: 400 });
  }
  const event = parseEvent(json);
  // Events the site doesn't use (template.*, malformed) are acknowledged and ignored.
  if (!event) return NextResponse.json({ ok: true, ignored: true });
  try {
    const outcome = await handleDocusealEvent(event, json);
    console.info("[docuseal-webhook]", event.type, event.submissionId, outcome);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[docuseal-webhook] failed", event.type, event.submissionId, (e as Error).message);
    return new NextResponse("Try again", { status: 500 });
  }
}
