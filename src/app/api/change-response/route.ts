import { NextResponse } from "next/server";

import { toCents } from "@/lib/crm/fees";
import { notifyChangeAnswered } from "@/lib/crm/notify";
import { listPaymentsAdmin, resyncJobPaidState } from "@/lib/crm/payments";
import { getStaffPhoneById, recordChangeResponse } from "@/lib/crm/queries";

// The customer answering a change order, from behind their own quote link.
//
// Sibling of /api/quote-response and deliberately its own endpoint rather than
// another action on that one: this answers a question about a job that is
// already agreed and booked, and the two have nothing in common beyond being
// posted from the same page. Mixing them would mean one handler where half the
// branches are unreachable depending on which state the quote is in.
export async function POST(request: Request) {
  let body: { token?: unknown; action?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token : "";
  const action = body.action === "accept" || body.action === "decline" ? body.action : null;
  if (!action) return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });

  const result = await recordChangeResponse(token, action);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });

  // Nothing was waiting, so nobody is told again. From the customer's side the
  // button worked and there is nothing left to do, which is the truth.
  if (result.duplicate) return NextResponse.json({ ok: true });

  // Best-effort from here. A texting outage must never fail the customer's
  // answer - the price has already moved, and that is the part that matters.
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

      // Whether the job still counts as paid, in whichever direction the change
      // pushed it. Both are real: dropping the scope to below what they have
      // paid finishes the job off, and raising the total on a job already
      // stamped paid puts it back into owing money - and leaving that stamp on
      // would keep it out of "customers still owe" on the Money page for good.
      //
      // One function owns that question so the two directions cannot disagree.
      if (action === "accept") await resyncJobPaidState(q.id);
    }
  } catch {
    // ignore - texting must never fail the customer's answer
  }

  return NextResponse.json({ ok: true });
}
