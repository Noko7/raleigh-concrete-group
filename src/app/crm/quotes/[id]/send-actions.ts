"use server";

import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/crm/auth";
import { QUOTE_SECTION_FIELDS } from "@/lib/crm/constants";
import { QUOTE_TEXT_KINDS } from "@/lib/crm/messages";
import { sendHeldMessageNow } from "@/lib/crm/notify";
import {
  addEvent,
  cancelMessage,
  cancelQueuedFor,
  getMessage,
  isHeld,
  getQuote,
  saveQuoteOptions,
  saveQuotePackages,
  updateQuote,
} from "@/lib/crm/queries";
import type { Quote } from "@/lib/crm/types";
import type { ScheduleState } from "./types";

/**
 * Send a queued text now instead of at its hour. Open to the crew: a
 * contractor correcting a price at 6:30am shouldn't leave the wrong number
 * waiting on the office. Not gated like cancelling, which destroys a quote;
 * this only changes WHEN an approved text goes out. Access is "can load the
 * job", and the quote id scopes the lookup.
 */
export async function sendHeldTextNow(_prev: ScheduleState, formData: FormData): Promise<ScheduleState> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Your session expired. Please sign in again." };
  const id = String(formData.get("id") ?? "");
  const messageId = String(formData.get("messageId") ?? "");
  if (!id || !messageId) return { ok: false, error: "Missing message." };

  const current = await getQuote(session, id);
  if (!current) return { ok: false, error: "You don't have access to this job." };

  // Re-read the row: the page's view goes stale fast in this window.
  const held = await getMessage(messageId, id);
  if (!held) return { ok: false, error: "That text is no longer in the queue." };
  if (!isHeld(held)) {
    return {
      ok: false,
      error: held.cancelled_at
        ? "That text was cancelled, so there is nothing to send."
        : "That text has already gone out.",
    };
  }

  const r = await sendHeldMessageNow(held);
  await addEvent(session, id, "message_sent_early", {
    kind: held.kind,
    role: held.role,
    was_due: held.send_after ?? null,
    delivered: r.ok,
  });

  revalidatePath(`/crm/quotes/${id}`);
  revalidatePath("/crm");
  revalidatePath("/job/[token]", "page");

  if (!r.ok) {
    // The provider's own words, so the user has something to act on.
    return { ok: false, error: [r.detail, r.status ? `(HTTP ${r.status})` : ""].filter(Boolean).join(" ").slice(0, 500) };
  }
  return { ok: true, message: "Sent. It has gone out now rather than waiting." };
}

/**
 * Stop a text that hasn't gone out, and for a quote text, the quote too.
 *
 * Cancelling a quote's TEXT cancels the QUOTE: otherwise the job stays Quoted,
 * the link opens, and the follow-up cron chases a quote nobody received. So it
 * runs the same wipe as a retraction (wipeQuote below), and is owner-only for
 * the same reason. Other held texts anyone with job access can stop.
 *
 * Only while still waiting: cancelMessage won't touch a row past send_after,
 * so it can't race a flush.
 */
export async function cancelHeldMessage(_prev: ScheduleState, formData: FormData): Promise<ScheduleState> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Your session expired. Please sign in again." };
  const id = String(formData.get("id") ?? "");
  const messageId = String(formData.get("messageId") ?? "");
  if (!id || !messageId) return { ok: false, error: "Missing message." };

  // The message log has no write policy, so access is "can load the job"; the
  // quote id scopes the update so a guessed message id does nothing.
  const current = await getQuote(session, id);
  if (!current) return { ok: false, error: "You don't have access to this job." };

  // Read first, so the permission check uses the real row, not the form.
  const held = await getMessage(messageId, id);
  if (!held) return { ok: false, error: "That text is no longer in the queue." };

  const isQuote = QUOTE_TEXT_KINDS.has(held.kind);
  if (isQuote && session.staff.role !== "owner") {
    return {
      ok: false,
      error: "Only the owner can cancel a quote. Ask them to retract it, or send a corrected quote instead.",
    };
  }
  if (isQuote && current.scheduled_date) {
    return { ok: false, error: "This job has a booked work day. Release the date first." };
  }

  const cancelled = await cancelMessage(messageId, id, new Date().toISOString());
  if (!cancelled) {
    return { ok: false, error: "Too late: that text has already gone out or is being sent right now." };
  }
  await addEvent(session, id, "message_cancelled", { kind: cancelled.kind, role: cancelled.role });

  let wiped = false;
  if (isQuote) {
    wiped = await wipeQuote(session, id);
    if (wiped) {
      await addEvent(session, id, "quote_retracted", { amount: current.quote_amount, texts_cancelled: 1 });
      await addEvent(session, id, "links_rotated");
    }
  }

  revalidatePath(`/crm/quotes/${id}`);
  revalidatePath("/crm");
  revalidatePath("/job/[token]", "page");
  return {
    ok: true,
    message: wiped
      ? "Quote cancelled. The text never went out, the price and wording are cleared, and the job is back in New."
      : "That text has been stopped. It will not send.",
  };
}

/**
 * The wipe shared by retracting and cancelling a quote, which must clear the
 * same fields. Callers check permissions first. The row goes first: a partial
 * failure leaves line items on an unquoted job (fixable), not a live link on a
 * job the UI calls retracted.
 */
async function wipeQuote(
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
  id: string,
): Promise<boolean> {
  const patch: Partial<Quote> = {
    // Rotated, so the held link (and any forwarded copy) stops resolving.
    public_token: crypto.randomUUID().replace(/-/g, ""),
    quote_amount: null,
    quote_summary: null,
    quote_sent_at: null,
    quote_expires_at: null,
    quote_followup_sent_at: null,
    // Any answer was to a quote that no longer exists.
    customer_response: null,
    customer_responded_at: null,
    status: "new",
  };
  for (const f of QUOTE_SECTION_FIELDS) patch[f] = null;

  const updated = await updateQuote(session, id, patch);
  if (!updated) return false;
  await saveQuoteOptions(session, id, []).catch(() => ({ ok: false }));
  // Packages too: a leftover package is a price that goes out again.
  await saveQuotePackages(session, id, []).catch(() => ({ ok: false }));
  return true;
}

/**
 * Take a sent quote back (wrong customer, sent too early). All four or it
 * isn't a retraction:
 *
 *   1. Rotate public_token: the link dies immediately, forwarded copies too.
 *   2. Cancel queued texts, or the dead link goes out at 8am.
 *   3. Clear pricing: amount, sections, line items, packages.
 *   4. Back to New with sent stamps cleared, so pipeline, follow-up and the
 *      duplicate-send guard stop thinking they have a price.
 *
 * Owner only: none of it is undoable from the UI. Refused with a booked work
 * day: releasing a date is its own decision with its own customer text.
 */
export async function retractQuote(_prev: ScheduleState, formData: FormData): Promise<ScheduleState> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Your session expired. Please sign in again." };
  if (session.staff.role !== "owner") {
    return { ok: false, error: "Only the owner can retract a quote." };
  }

  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing quote id." };

  const current = await getQuote(session, id);
  if (!current) return { ok: false, error: "You don't have access to this quote." };
  if (!current.quote_sent_at) return { ok: false, error: "Nothing has been sent to this customer yet." };
  if (current.scheduled_date) {
    return {
      ok: false,
      error: "This job has a booked work day. Release the date first, then retract the quote.",
    };
  }

  // Captured before the wipe for the log.
  const was = current.quote_amount;

  if (!(await wipeQuote(session, id))) {
    return { ok: false, error: "Could not retract this quote. Please try again." };
  }
  const stopped = await cancelQueuedFor(id, new Date().toISOString());

  await addEvent(session, id, "quote_retracted", { amount: was, texts_cancelled: stopped });
  await addEvent(session, id, "links_rotated");

  revalidatePath(`/crm/quotes/${id}`);
  revalidatePath("/crm");
  revalidatePath("/job/[token]", "page");
  return {
    ok: true,
    message:
      `Quote retracted. The customer's link is dead${stopped > 0 ? ` and ${stopped} queued text(s) were stopped` : ""}. ` +
      "The job is back in New with no price on it.",
  };
}
