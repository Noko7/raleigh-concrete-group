import { after, NextResponse } from "next/server";

import { ADMIN_READY } from "@/lib/crm/env";
import { alertOwner } from "@/lib/crm/notify";
import { pgAdmin } from "@/lib/crm/rest";
import { isValidUsPhone, UUID_RE } from "@/lib/quote-submit";
import { clientIp, rateLimit } from "@/lib/rate-limit";

// A quote form in progress (supabase/quote-drafts.sql). The form sends what the
// customer has typed once there's a name and a number to call, again as they go
// on, and one last time - with `left: true` - if they close the tab without
// sending it. That last one texts the owner, once per form, so somebody who got
// stuck on the address at 11pm is a phone call in the morning rather than a
// Clarity recording nobody watches.
//
// Always 204, like /api/funnel: the customer is never waiting on this and must
// never see it fail. It is a safety net under /api/quote, not a step of it.

const STEPS = new Set(["contact", "service", "schedule"]);

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  const noContent = new NextResponse(null, { status: 204 });
  if (!ADMIN_READY) return noContent;

  try {
    const raw = await request.text().catch(() => "");
    if (!raw || raw.length > 4000) return noContent;
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return noContent;
    }
    if (!body || typeof body !== "object") return noContent;

    const submissionId = str(body.submission_id, 64).toLowerCase();
    const name = str(body.name, 120);
    const phone = str(body.phone, 32);
    // Nothing to call back is nothing worth keeping.
    if (!UUID_RE.test(submissionId) || !isValidUsPhone(phone)) return noContent;

    // A few saves per step and one on the way out. Sized for a person, not a loop.
    if (await rateLimit(`draft:${clientIp(request)}`, 60, 10 * 60 * 1000)) return noContent;

    const stepRaw = str(body.step, 16);
    const modeRaw = str(body.mode, 16);
    const left = body.left === true;
    const now = new Date().toISOString();
    const row: Record<string, unknown> = {
      submission_id: submissionId,
      updated_at: now,
      name: name || null,
      phone,
      email: str(body.email, 200) || null,
      address: str(body.address, 300) || null,
      mode: modeRaw === "online" || modeRaw === "inperson" ? modeRaw : null,
      service: str(body.service, 120) || null,
      step: STEPS.has(stepRaw) ? stepRaw : null,
      source_path: str(body.source_path, 300) || null,
    };
    if (left) row.left_at = now;

    // Upsert on the form's id. Only the columns above are written, so a save
    // never clears lead_id or alerted_at on a form that's already been sent.
    const res = await pgAdmin("quote_drafts?on_conflict=submission_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(row),
    });
    if (!res.ok) {
      console.error("[draft] save failed", res.status, (await res.text().catch(() => "")).slice(0, 300));
      return noContent;
    }

    // Each alert is a text to the owner, so it has its own, much tighter limit:
    // a person abandons a form or two, not a dozen. Past it the draft is still
    // saved and listed in the CRM; only the text is skipped.
    if (left && (await rateLimit(`draft-alert:${clientIp(request)}`, 3, 60 * 60 * 1000))) {
      console.warn("[draft] abandoned-form alerts rate limited", { ip: clientIp(request) });
      return noContent;
    }

    if (left) {
      // Claim the alert: only a form that hasn't been sent and hasn't already
      // been alerted comes back from this, so two "left" beacons for one form
      // (pagehide fires more than once on some phones) still text once.
      const claim = await pgAdmin(
        `quote_drafts?submission_id=eq.${submissionId}&lead_id=is.null&alerted_at=is.null`,
        {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({ alerted_at: now }),
        },
      );
      const claimed = claim.ok ? ((await claim.json().catch(() => [])) as unknown[]) : [];
      if (claimed.length) {
        const where =
          row.step === "schedule"
            ? "on the last step (picking a time)"
            : row.step === "service"
              ? "on the service step"
              : "on the contact step";
        const message = [
          "QUOTE STARTED, NOT SENT",
          "",
          `Someone started the quote form and closed it ${where} without sending it. Worth a call:`,
          "",
          `Name: ${name || "(not given)"}`,
          `Phone: ${phone}`,
          row.address ? `Address: ${row.address}` : null,
          row.service ? `Service: ${row.service}` : null,
          "",
          "If they come back and send it you'll get the usual new-lead text. They have NOT agreed to texts yet - call, don't text. Listed in CRM > Funnel.",
        ]
          .filter((l) => l !== null)
          .join("\n");
        after(() => alertOwner(message, null, { quoteId: null, kind: "quote_abandoned" }).catch(() => {}));
      }
    }
  } catch (e) {
    console.error("[draft] unhandled error", e);
  }
  return noContent;
}
