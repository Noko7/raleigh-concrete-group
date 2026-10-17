import { NextResponse } from "next/server";

import { toCents } from "@/lib/crm/fees";
import { notifyChangeAnswered } from "@/lib/crm/notify";
import { listPaymentsAdmin, resyncJobPaidState } from "@/lib/crm/payments";
import { getStaffPhoneById, recordChangeResponse } from "@/lib/crm/queries";
import { clientIp, rateLimit } from "@/lib/rate-limit";

// The customer answering a change order from their quote link. Separate from /api/quote-response: it
// concerns an already-agreed job and shares nothing but the page.
export async function POST(request: Request) {
  let body: { token?: unknown; action?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }
  // Duplicates are already handled downstream; this only stops a script on the endpoint.
  if (await rateLimit(`chresp:${clientIp(request)}`, 20, 10 * 60 * 1000)) {
    return NextResponse.json(
      { ok: false, error: "Too many attempts. Please give us a call." },
      { status: 429 },
    );
  }

  const token = typeof body.token === "string" ? body.token : "";
  const action = body.action === "accept" || body.action === "decline" ? body.action : null;
  if (!action) return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });

  const result = await recordChangeResponse(token, action);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });

  // Nothing was waiting: nobody is told again, and the customer still sees success.
  if (result.duplicate) return NextResponse.json({ ok: true });

  // Best-effort from here: the price has already moved, and a texting outage must not fail the answer.
  try {
    const q = result.quote;
    if (q) {
      const rows = await listPaymentsAdmin(q.id);
      const paidCents = rows
        .filter((r) => r.status === "paid" || r.status === "refunded")
        .reduce((sum, r) => sum + r.amount_cents - r.refunded_cents, 0);

      const contractorPhone = q.assigned_to ? await getStaffPhoneById(q.assigned_to) : null;
      await notifyChangeAnswered(
        q,
        action === "accept",
        {
          note: result.note ?? "",
          fromCents: toCents(result.from),
          toCents: toCents(result.to),
          paidCents,
          depositCents: result.depositCents ?? null,
        },
        contractorPhone,
      );

      // A change can push paid state either way (below what's paid, or a paid job back into owing);
      // resyncJobPaidState owns both directions.
      if (action === "accept") await resyncJobPaidState(q.id);
    }
  } catch {
    // texting must never fail the customer's answer
  }

  return NextResponse.json({ ok: true });
}
