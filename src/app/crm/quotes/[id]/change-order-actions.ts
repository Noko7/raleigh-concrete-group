"use server";

import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/crm/auth";
import { optionsTotal, firstNameOf, parseDollars } from "@/lib/crm/constants";
import { isRecordedMethod, toCents, usd, type RecordedMethod } from "@/lib/crm/fees";
import { notifyChangeRequested, type SendResult } from "@/lib/crm/notify";
import {
  addEvent,
  cancelChange,
  getQuote,
  parseQuoteOptions,
  recordChangeAgreed,
  requestChange,
} from "@/lib/crm/queries";
import { jobLedger, resyncJobPaidState } from "@/lib/crm/payments";
import { changeOrderRefusal } from "@/lib/crm/permissions";
import type { QuoteOptionDraft } from "@/lib/crm/constants";
import type { ChangeState } from "./types";
import { takeManualPayment } from "./manual-payment";

// A change on an agreed (often booked, part-paid) job, e.g. the patio two feet
// wider. The quote editor is for unaccepted prices; a change order moves the
// price WITH the customer's say-so, answered on their link. Deposits need
// nothing here: the ledger is "current total minus collected".
export async function sendChangeOrder(_prev: ChangeState, formData: FormData): Promise<ChangeState> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Your session expired. Please sign in again." };

  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing job id." };
  const note = String(formData.get("note") ?? "");
  const raw = String(formData.get("amount") ?? "").trim();
  if (raw === "") return { ok: false, error: "Enter the new total for the job." };

  // The review step's tick, enforced server-side. The customer approves a
  // BALANCE (new total less paid), so a mis-recorded deposit makes their figures
  // wrong while the total looks fine. This records that someone checked.
  if (String(formData.get("payments_checked") ?? "") !== "yes") {
    return { ok: false, error: "Open the review step and confirm the recorded payments before sending this." };
  }

  const current = await getQuote(session, id);
  if (!current) return { ok: false, error: "You don't have access to this job." };

  // The total the preview was drawn against. If the job was repriced since
  // (another tab), the reviewed difference is wrong, so refuse.
  const shown = String(formData.get("shown_total") ?? "").trim();
  if (shown !== "" && Number(shown) !== toCents(current.quote_amount)) {
    return {
      ok: false,
      error: "The price on this job changed while you were writing. Close this and start the change again.",
    };
  }

  // Optional breakdown. Same parser as the quote editors (same caps); every
  // line is part of the job, so all are required.
  let lines: QuoteOptionDraft[] = [];
  if (formData.has("lines_json")) {
    let parsedJson: unknown = [];
    try {
      parsedJson = JSON.parse(String(formData.get("lines_json") ?? "[]"));
    } catch {
      return { ok: false, error: "Could not read the price breakdown. Please try again." };
    }
    const parsed = parseQuoteOptions(parsedJson);
    if (parsed.error) return { ok: false, error: parsed.error };
    lines = parsed.rows.map((r) => ({ ...r, id: undefined, required: true }));
  }

  // Same ledger as every screen, so the log matches the money card and a
  // second deposit is checked against the real balance.
  const { ledger } = await jobLedger(current);

  // Already agreed (phone, on site): apply now, no text.
  const agreed = String(formData.get("agreed") ?? "") === "yes";
  // Applying without asking is owner-only (enforced here, not just hidden on
  // the card). A contractor's change may only raise the total, since they can
  // reach the customer's Approve themselves. With lines the total is their sum,
  // as requestChange computes; non-numbers are left for requestChange to refuse.
  const newTotal = lines.length > 0 ? optionsTotal(lines) : Number(raw);
  const notAllowed = changeOrderRefusal(session.staff.role, {
    agreed,
    customerName: current.name,
    fromTotal: current.quote_amount,
    toTotal: Number.isFinite(newTotal) ? newTotal : undefined,
  });
  if (notAllowed) return { ok: false, error: notAllowed };

  // Optional second deposit, typed in dollars. Only when asking; money taken in
  // person goes on the payments card.
  let depositCents: number | null = null;
  if (!agreed && String(formData.get("deposit_on") ?? "") === "yes") {
    const typed = parseDollars(formData.get("deposit"));
    depositCents = Number.isFinite(typed) ? Math.round(typed * 100) : NaN;
  }

  // Payment taken on the spot for an agreed change. Recorded after the new total
  // lands, so it counts against the new balance.
  let paidNow: { method: RecordedMethod; amountCents: number } | null = null;
  if (agreed && String(formData.get("paid_on") ?? "") === "yes") {
    const method = String(formData.get("paid_method") ?? "");
    if (!isRecordedMethod(method)) return { ok: false, error: "Pick how they paid for the change." };
    const typed = parseDollars(formData.get("paid_amount"));
    if (!Number.isFinite(typed) || typed <= 0) return { ok: false, error: "Enter how much they paid for the change." };
    paidNow = { method, amountCents: Math.round(typed * 100) };
  }

  const result = await requestChange(session, id, {
    note,
    newAmount: Number(raw),
    lines,
    depositCents,
    paidCents: ledger.paidCents,
  });
  if (!result.ok || !result.quote) return { ok: false, error: result.error ?? "Could not send that change." };
  const quote = result.quote;

  // Check against the new balance before anything moves, so a typo can't apply
  // the price and refuse the payment. The change is withdrawn to resend.
  if (paidNow) {
    const newDue = toCents(quote.change_amount) - ledger.paidCents;
    if (paidNow.amountCents > newDue) {
      await cancelChange(session, id).catch(() => {});
      return {
        ok: false,
        error: `That's more than the ${usd(Math.max(0, newDue))} they'll owe after this change. Enter the amount actually taken.`,
      };
    }
  }

  await addEvent(session, id, "change_requested", {
    note: quote.change_note,
    from: quote.quote_amount,
    to: quote.change_amount,
    lines: quote.change_lines,
    deposit_cents: quote.change_deposit_cents,
    paid_cents: ledger.paidCents,
    // Who confirmed the recorded payments the customer's balance rests on.
    payments_checked_by: session.staff.full_name || session.staff.email || "Staff",
    ...(agreed ? { agreed: true } : {}),
  });

  const firstName = firstNameOf(quote.name, quote.name);

  // Already agreed: nobody to text. Applied through the same transaction as the
  // customer's button, logged with who recorded it.
  if (agreed) {
    const applied = await recordChangeAgreed(session, id);
    if (!applied.ok || applied.duplicate) {
      // Written but not applied: leave it pending so it can be withdrawn and redone.
      return { ok: false, error: "The change was saved but the price didn't update. Withdraw it and try again." };
    }
    await resyncJobPaidState(id).catch(() => {});

    const newTotal = usd(toCents(applied.to ?? quote.change_amount));
    let message = `Job updated to ${newTotal}. ${firstName} was not texted.`;
    let warning: string | undefined;
    if (paidNow && applied.quote) {
      const taken = await takeManualPayment(session, applied.quote, {
        ...paidNow,
        note: `For the change: ${quote.change_note ?? ""}`.slice(0, 500),
      });
      if (taken.ok) {
        message = `Job updated to ${newTotal} and ${usd(paidNow.amountCents)} recorded. ${
          (taken.dueCents ?? 0) > 0 ? `${usd(taken.dueCents ?? 0)} still to collect.` : "Paid in full."
        } ${firstName} was not texted.`;
      } else {
        warning = `The price is updated, but the ${usd(paidNow.amountCents)} payment didn't save: ${taken.error ?? "try again"}. Record it on the payments card.`;
      }
    }

    revalidatePath(`/crm/quotes/${id}`);
    revalidatePath("/crm");
    revalidatePath("/crm/money");
    revalidatePath("/job/[token]", "page");

    return { ok: true, message, warning };
  }

  // The customer's text has the change and link, never figures (see
  // notifyChangeRequested). Answers come back via /api/change-response.
  const sent = await notifyChangeRequested(
    {
      id,
      name: quote.name,
      phone: quote.phone,
      service: quote.service,
      address: quote.address,
      scheduled_date: quote.scheduled_date,
      scheduled_time: quote.scheduled_time,
      public_token: quote.public_token,
      job_token: quote.job_token,
    },
    quote.change_note ?? "",
  ).catch((): SendResult => ({ ok: false, provider: "unknown", detail: "Send failed" }));

  await addEvent(session, id, "change_delivery", {
    delivered: sent.ok,
    to: sent.to ?? quote.phone,
    held_until: sent.sendAfter ?? null,
    error: sent.ok ? null : (sent.detail ?? null),
  });

  revalidatePath(`/crm/quotes/${id}`);
  revalidatePath("/crm");
  revalidatePath("/job/[token]", "page");

  return {
    ok: true,
    sent: sent.ok,
    smsError: sent.ok ? undefined : sent.detail,
    smsHeldUntil: sent.held ? sent.sendAfterLabel : undefined,
    smsTo: sent.to ?? quote.phone,
    message: `Change sent to ${firstName} to approve. Nothing moves until they do.`,
  };
}

// The price never moved, so withdrawing just takes the question off the
// customer's page.
export async function withdrawChangeOrder(_prev: ChangeState, formData: FormData): Promise<ChangeState> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Your session expired. Please sign in again." };

  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing job id." };

  const before = await getQuote(session, id);
  const result = await cancelChange(session, id);
  if (!result.ok) return { ok: false, error: result.error ?? "Could not withdraw that change." };

  await addEvent(session, id, "change_withdrawn", {
    note: before?.change_note ?? null,
    to: before?.change_amount ?? null,
  });
  // No customer text: whoever withdrew it just spoke to them.

  revalidatePath(`/crm/quotes/${id}`);
  revalidatePath("/crm");
  revalidatePath("/job/[token]", "page");
  return { ok: true, message: "Change withdrawn. The price is unchanged." };
}
