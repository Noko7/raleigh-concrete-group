"use server";

import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/crm/auth";
import {
  QUOTE_SECTION_FIELDS,
  QUOTE_SECTION_LABELS,
  PACKAGE_DESC_MAX,
  PACKAGE_TITLE_MAX,
  QUOTE_TTL_DAYS,
  MAX_QUOTE_PACKAGES,
  allInTotal,
  isChoice,
  noEmDash,
  optionsTotal,
  visitDateOf,
  firstNameOf,
} from "@/lib/crm/constants";
import { STATUSES, type Status } from "@/lib/crm/env";
import { syncQuoteToCalendar } from "@/lib/crm/gcal";
import {
  notifyAssignment,
  notifyComplete,
  notifyQuoteOptionAdded,
  notifyQuoteReady,
  notifyQuoteSent,
  notifyQuoteUpdated,
  type SendResult,
} from "@/lib/crm/notify";
import {
  cancelQueuedFor,
  addEvent,
  conflictMessage,
  findJobConflict,
  findVisitConflict,
  clearQuoteResponses,
  getQuote,
  getStaffById,
  lastMessageOf,
  listQuoteOptions,
  listQuotePackages,
  optionsAsDrafts,
  packagesAsDrafts,
  parseQuoteOptions,
  parseQuotePackages,
  sameOptions,
  samePackages,
  saveQuoteOptions,
  saveQuotePackages,
  updateQuote,
} from "@/lib/crm/queries";
import { jobPatchRefusal } from "@/lib/crm/permissions";
import type { Quote } from "@/lib/crm/types";
import type { QuoteOptionDraft, QuotePackageDraft } from "@/lib/crm/constants";
import type { SaveState } from "./types";

export async function saveQuote(_prev: SaveState, formData: FormData): Promise<SaveState> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Your session expired. Please sign in again." };

  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing quote id." };

  const current = await getQuote(session, id);
  if (!current) return { ok: false, error: "You don't have access to this quote." };

  const isOwner = session.staff.role === "owner";
  // "resend" is a deliberate owner-only second send; otherwise same as "send".
  const intent = String(formData.get("intent") ?? "");
  const sending = intent === "send" || intent === "resend";
  const patch: Partial<Quote> = {};
  const events: { type: string; meta?: Record<string, unknown> }[] = [];
  // Does this save change anything the customer reads (price, sections, legacy
  // summary)? Separates a correction from a duplicate send below.
  let contentChanged = false;
  // Set at send time: replaces a quote the customer has but hasn't answered.
  let revising = false;

  // Status
  const status = String(formData.get("status") ?? "");
  if (status && STATUSES.includes(status as Status) && status !== current.status) {
    patch.status = status as Status;
    if (status === "quoted" && !current.quote_sent_at) patch.quote_sent_at = new Date().toISOString();
    if (status === "completed" && !current.completed_at) patch.completed_at = new Date().toISOString();
    if (status === "paid" && !current.paid_at) patch.paid_at = new Date().toISOString();
    events.push({ type: "status_changed", meta: { from: current.status, to: status } });
  }

  // Reopening a declined quote (moved off Lost, or sent again) forgets the "no",
  // or their link keeps showing the declined page instead of the quote just
  // texted. It also unlocks the line items. Accepted quotes are never reopened
  // this way: they have a booked day and a ledger. Declined-but-not-Lost counts:
  // someone meant to reopen it.
  const reopening = current.customer_response === "declined" && (sending || (patch.status ?? current.status) !== "lost");
  if (reopening) {
    patch.customer_response = null;
    patch.customer_responded_at = null;
    patch.discount_accepted = false;
    events.push({ type: "quote_reopened" });
  }
  // The customer's answer after this save.
  const response = reopening ? null : current.customer_response;

  // Assignment (owner only)
  if (isOwner && formData.has("assigned_to")) {
    const raw = String(formData.get("assigned_to") ?? "").trim();
    const next = raw === "" ? null : raw;
    if (next !== current.assigned_to) {
      // Reassigning a dated job puts that date on the new person's calendar, so
      // it must pass the same conflict checks as a booking. Both appointments
      // are checked, since a row can carry a work day and a visit at once.
      const jobDate = current.scheduled_date;
      const seeDate = visitDateOf(current);
      const clash =
        (jobDate ? await findJobConflict(next, jobDate, id) : null) ??
        (seeDate ? await findVisitConflict(next, seeDate, current.visit_time ?? "", id) : null);
      if (clash) return { ok: false, error: conflictMessage(clash) };

      patch.assigned_to = next;
      events.push({ type: "assigned", meta: { to: next } });
    }
  }

  // Line items: both editors post the whole list as JSON, replacing what's
  // stored. Locked once answered: the rows' accepted/declined stamps are the
  // record of what was bought.
  const existingOptions = await listQuoteOptions(session, id);
  let optionRows: QuoteOptionDraft[] | null = null;
  if (formData.has("options_json") && !response) {
    let raw: unknown = [];
    try {
      raw = JSON.parse(String(formData.get("options_json") ?? "[]"));
    } catch {
      return { ok: false, error: "Could not read the line items. Please try again." };
    }
    const parsed = parseQuoteOptions(raw);
    if (parsed.error) return { ok: false, error: parsed.error };

    if (sameOptions(optionsAsDrafts(existingOptions), parsed.rows)) {
      // Identical to what's stored: nothing to write, and not a correction.
      optionRows = null;
    } else {
      optionRows = parsed.rows;
      contentChanged = true;
      events.push({ type: "options_changed", meta: { count: optionRows.length, total: optionsTotal(optionRows) } });
    }
  }

  // Packages: same as line items, and locked once answered for the same reason.
  // A lone card is saved but can't be sent (checked at send time below).
  const existingPackages = await listQuotePackages(session, id);
  let packageRows: QuotePackageDraft[] | null = null;
  if (formData.has("packages_json") && !response) {
    let raw: unknown = [];
    try {
      raw = JSON.parse(String(formData.get("packages_json") ?? "[]"));
    } catch {
      return { ok: false, error: "Could not read the options. Please try again." };
    }
    const parsed = parseQuotePackages(raw);
    if (parsed.error) return { ok: false, error: parsed.error };

    if (samePackages(packagesAsDrafts(existingPackages), parsed.rows)) {
      packageRows = null;
    } else {
      packageRows = parsed.rows;
      contentChanged = true;
      events.push({ type: "packages_changed", meta: { count: packageRows.length } });
    }
  }

  // The price. With line items it's their sum; the posted amount is ignored so a
  // stale form can't undo a just-added item. With a choice, the row carries the
  // lead option (marked, else first) plus extras: a pipeline headline only; the
  // customer page prices each option. Only while unanswered: after, the price
  // is what they picked, and re-deriving it would bill for declined extras.
  const effectiveOptions = optionRows ?? optionsAsDrafts(existingOptions);
  const effectivePackages = packageRows ?? packagesAsDrafts(existingPackages);
  const answered = Boolean(response);
  const itemised = effectiveOptions.length > 0 && !answered;
  const offersChoice = isChoice(effectivePackages) && !answered;

  if (itemised || offersChoice) {
    const total = allInTotal(effectivePackages, effectiveOptions);
    if (total !== Number(current.quote_amount)) {
      patch.quote_amount = total;
      contentChanged = true;
      events.push({ type: "amount_changed", meta: { from: current.quote_amount, to: total } });
    }
  } else if (formData.has("quote_amount")) {
    const raw = String(formData.get("quote_amount") ?? "").trim();
    if (raw === "") {
      patch.quote_amount = null;
    } else {
      const amt = Number(raw);
      if (!Number.isFinite(amt) || amt < 0 || amt > 99_999_999) {
        return { ok: false, error: "Enter a valid quote amount." };
      }
      patch.quote_amount = Math.round(amt * 100) / 100;
    }
    if (patch.quote_amount !== current.quote_amount) {
      contentChanged = true;
      events.push({ type: "amount_changed", meta: { from: current.quote_amount, to: patch.quote_amount } });
    }
  }

  // Customer name: typos follow the customer through every text, so it's editable.
  if (formData.has("name")) {
    const v = String(formData.get("name") ?? "").trim().slice(0, 120);
    if (v.length < 2) return { ok: false, error: "Enter the customer's name." };
    if (v !== current.name) {
      patch.name = v;
      events.push({ type: "name_changed", meta: { from: current.name, to: v } });
    }
  }

  // Legacy summary, superseded by the five sections; kept so old quotes stay editable.
  if (formData.has("quote_summary")) {
    const v = noEmDash(String(formData.get("quote_summary") ?? "").trim()).slice(0, 4000);
    patch.quote_summary = v || null;
    if (patch.quote_summary !== current.quote_summary) {
      contentChanged = true;
      events.push({ type: "summary_changed" });
    }
  }

  // The five sections. "Not applicable" is fine, blank isn't, but that's
  // checked at send time so drafts can be saved half-written.
  let sectionsChanged = false;
  for (const field of QUOTE_SECTION_FIELDS) {
    if (!formData.has(field)) continue;
    const v = noEmDash(String(formData.get(field) ?? "").trim()).slice(0, 2000);
    const next = v || null;
    if (next !== current[field]) sectionsChanged = true;
    patch[field] = next;
  }
  if (sectionsChanged) {
    contentChanged = true;
    events.push({ type: "summary_changed" });
  }

  // Internal notes
  if (formData.has("internal_notes")) {
    const v = String(formData.get("internal_notes") ?? "").trim().slice(0, 4000);
    patch.internal_notes = v || null;
    if (patch.internal_notes !== current.internal_notes) events.push({ type: "notes_changed" });
  }

  // What the customer will see: this save's values, else stored ones. Also used
  // in the texts below so they report the quoted figure.
  const effectiveAmount =
    itemised || offersChoice
      ? allInTotal(effectivePackages, effectiveOptions)
      : patch.quote_amount !== undefined
        ? patch.quote_amount
        : current.quote_amount;
  const effectiveSummary = patch.quote_summary !== undefined ? patch.quote_summary : current.quote_summary;

  if (sending) {
    if (itemised && !offersChoice && optionsTotal(effectiveOptions) <= 0) {
      return { ok: false, error: "Put a price on at least one line item before sending." };
    }
    // One lone option is a half-written choice: saved, but not sent.
    if (!answered && effectivePackages.length > 0 && !isChoice(effectivePackages)) {
      return {
        ok: false,
        error:
          "This quote has one option on it, which is not a choice. Add a second option, or remove the one you have and it goes out as a single price.",
      };
    }
    // Every option needs a price: a $0 card reads as unfinished, not free.
    if (offersChoice && effectivePackages.some((p) => p.amount <= 0)) {
      return { ok: false, error: "Put a price on every option before sending." };
    }
    if (effectiveAmount == null) return { ok: false, error: "Set a quote amount before sending." };

    // Every section must say something ("Not applicable" counts). Quotes from
    // before the sections pass on their legacy summary.
    const missing = QUOTE_SECTION_FIELDS.filter((f) => {
      const v = patch[f] !== undefined ? patch[f] : current[f];
      return !v || !v.trim();
    });
    const hasLegacySummary = Boolean(effectiveSummary && effectiveSummary.trim());
    if (missing.length > 0 && !hasLegacySummary) {
      const names = missing.map((f) => QUOTE_SECTION_LABELS[f]).join(", ");
      return {
        ok: false,
        error: `Fill in every section before sending. Still blank: ${names}. Put "Not applicable" if a section doesn't apply to this job.`,
      };
    }

    // A second send to an unanswered customer is either:
    //   a correction  price or scope was wrong. New information, its own
    //                 message, and the crew can send it themselves rather than
    //                 leave a wrong number in the customer's thread.
    //   a duplicate   nothing new; blocked below.
    revising = Boolean(current.quote_sent_at) && !response && contentChanged;

    // One quote text, then wait. Nothing visible happens on send, so people
    // press it again, and the customer sees ten identical texts. The block lifts
    // when: they've replied, the quote changed (a correction), the last text
    // never left, or an owner chose "resend".
    if (current.quote_sent_at && !response && !reopening && !revising) {
      const last = await lastMessageOf(session, id, "quote_ready");
      // No log row counts as delivered: when unsure, don't text twice.
      const reached = last ? last.ok : true;
      if (reached && !(intent === "resend" && isOwner)) {
        return {
          ok: false,
          error: `${firstNameOf(current.name, "The customer")} was already texted this quote and hasn't replied yet, so it won't send twice. If the quote itself was wrong, change the price or the wording and it goes out as a correction. If they say it never arrived, the owner can send it again.`,
          alreadySent: true,
        };
      }
    }
    if (current.status !== "quoted" && patch.status !== "quoted") {
      patch.status = "quoted";
      events.push({ type: "status_changed", meta: { from: current.status, to: "quoted" } });
    }
    if (!current.quote_sent_at) patch.quote_sent_at = new Date().toISOString();
    else if (revising) {
      // A correction restarts the clock: the 48h follow-up counts from this
      // text, and an already-nudged lead gets nudged again on the new price.
      patch.quote_sent_at = new Date().toISOString();
      patch.quote_followup_sent_at = null;
    }
    // Re-stamped on every send, so resending is how an expired quote is revived.
    patch.quote_expires_at = new Date(Date.now() + QUOTE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    events.push(
      revising
        ? { type: "quote_revised", meta: { from: current.quote_amount, to: effectiveAmount } }
        // Price on the event, so quote history survives later corrections.
        : { type: "quote_sent", meta: { amount: effectiveAmount } },
    );
  }

  // The editors hide the price once answered, but a hidden box isn't a rule:
  // this refuses a contractor re-pricing an approved job or marking it paid.
  const refusal = jobPatchRefusal(session.staff.role, current, patch);
  if (refusal) return { ok: false, error: refusal };

  if (!sending && Object.keys(patch).length === 0 && !optionRows && !packageRows) return { ok: true };

  try {
    // Line items first: the row's price derives from them, so a failure stops
    // the save rather than leave an unbacked total.
    if (optionRows) {
      const saved = await saveQuoteOptions(session, id, optionRows);
      if (!saved.ok) return { ok: false, error: saved.error ?? "Could not save the line items." };
    }
    if (packageRows) {
      const saved = await saveQuotePackages(session, id, packageRows);
      if (!saved.ok) return { ok: false, error: saved.error ?? "Could not save the options." };
    }

    if (Object.keys(patch).length > 0) {
      const updated = await updateQuote(session, id, patch);
      if (!updated) return { ok: false, error: "Could not save. Check your access and try again." };
    }
    // After the row, and only for rows not just rewritten (fresh rows carry no answers).
    if (reopening) await clearQuoteResponses(id);
    // Lost tells the customer nothing, and nothing already queued for them goes out after it either.
    if (patch.status === "lost" && current.status !== "lost") {
      await cancelQueuedFor(id, new Date().toISOString(), {
        role: "customer",
        detail: "Cancelled: the job was moved to Lost.",
      });
    }

    for (const e of events) await addEvent(session, id, e.type, e.meta);

    // Texts to a newly assigned contractor.
    if (patch.assigned_to) {
      const contractor = await getStaffById(session, patch.assigned_to);
      await notifyAssignment(
        contractor?.phone,
        {
          id,
          name: current.name,
          phone: current.phone,
          service: current.service,
          address: current.address,
          scheduled_date: current.scheduled_date,
          // Needed to tell a booked visit from an online customer's offered slot.
          quote_type: current.quote_type,
          visit_date: current.visit_date,
          visit_time: current.visit_time,
          job_token: current.job_token,
        },
        contractor?.full_name,
      ).catch(() => {});
      // No owner text: the assigner is the owner who'd be notified.
      await syncQuoteToCalendar(id);
    }
    // Completing via the status dropdown also thanks the customer.
    if (patch.status === "completed" && current.status !== "completed") {
      await notifyComplete({ id, name: current.name, phone: current.phone }).catch(() => {});
    }

    let smsDelivered = false;
    let smsError: string | undefined;
    let smsHeldUntil: string | undefined;
    let smsTo: string | undefined;
    if (sending) {
      // Not swallowed: the button's whole point is the customer receiving it,
      // so the provider's reason must reach the screen. A correction gets its
      // own wording; same link either way.
      const sendToCustomer = revising ? notifyQuoteUpdated : notifyQuoteReady;
      const r = await sendToCustomer({
        id,
        name: current.name,
        phone: current.phone,
        public_token: current.public_token,
      }).catch((e) => ({ ok: false, provider: "unknown", detail: String(e) }) as SendResult);

      smsDelivered = r.ok;
      smsTo = r.to ?? current.phone;
      if (r.held) smsHeldUntil = r.sendAfterLabel;
      else if (!r.ok) {
        smsError = [r.detail, r.status ? `(HTTP ${r.status})` : ""].filter(Boolean).join(" ").slice(0, 500);
      }
      // Marked sent either way (the link is live); the log records whether the
      // text reached them, so an outage is visible.
      await addEvent(session, id, "quote_delivery", {
        delivered: r.ok,
        held_until: r.sendAfter ?? null,
        to: smsTo,
        error: smsError ?? null,
        revised: revising,
      }).catch(() => {});

      // After the delivery result, so nothing claims a failed send; the full
      // result goes so a quiet-hours hold reads as queued, not failed.
      await notifyQuoteSent(
        {
          id,
          name: current.name,
          phone: current.phone,
          quote_amount: effectiveAmount,
          job_token: current.job_token,
        },
        { name: session.staff.full_name, phone: session.staff.phone },
        r,
        revising,
      ).catch(() => {});
    }

    revalidatePath(`/crm/quotes/${id}`);
    revalidatePath("/crm");
    // Contractors quote from their job page too.
    revalidatePath("/job/[token]", "page");
    return {
      ok: true,
      sent: sending,
      revised: sending ? revising : undefined,
      smsDelivered: sending ? smsDelivered : undefined,
      smsError: sending ? smsError : undefined,
      smsHeldUntil: sending ? smsHeldUntil : undefined,
      smsTo: sending ? smsTo : undefined,
    };
  } catch (err) {
    console.error("[saveQuote] failed", err);
    return { ok: false, error: "Something went wrong saving this quote. Please try again." };
  }
}

/**
 * Add another way of doing the job to a quote the customer already holds, e.g.
 * an asphalt price next to concrete that was too expensive, from a phone in a
 * driveway. Deliberately not saveQuote with a flag: it touches only packages.
 *
 * In one submit:
 *   1. First time only, the flat price becomes Option A.
 *   2. Adds the new option.
 *   3. Re-prices the row off the lead option, as saveQuote does.
 *   4. Re-sends, restamping expiry and clearing the follow-up.
 *   5. Logs quote_revised with the added title (shown in Quotes sent).
 *
 * The customer gets notifyQuoteOptionAdded, not the correction text: the
 * original price was never wrong.
 */
export async function addQuoteOption(_prev: SaveState, formData: FormData): Promise<SaveState> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Your session expired. Please sign in again." };

  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing quote id." };

  const current = await getQuote(session, id);
  if (!current) return { ok: false, error: "You don't have access to this quote." };

  // Only for a live, unanswered quote; each other state needs a different conversation.
  if (!current.quote_sent_at) {
    return { ok: false, error: "This quote hasn't gone out yet. Write both options into the quote itself and send it once." };
  }
  if (current.customer_response === "accepted") {
    return { ok: false, error: "They've already approved this quote. Adding an option now would change a job they've agreed to, so this needs a fresh quote." };
  }
  if (current.customer_response === "declined" || current.status === "lost") {
    return { ok: false, error: "This quote is marked declined. Ask the office to reopen it before sending another option." };
  }
  if (current.status === "completed" || current.status === "paid") {
    return { ok: false, error: "This job is already closed out." };
  }

  const money = (raw: string): number | null => {
    const n = Number(String(raw).trim());
    if (!Number.isFinite(n) || n <= 0 || n > 99_999_999) return null;
    return Math.round(n * 100) / 100;
  };
  const words = (raw: string, cap: number) => noEmDash(String(raw ?? "").trim()).slice(0, cap);

  const [existingPackages, existingOptions] = await Promise.all([
    listQuotePackages(session, id),
    listQuoteOptions(session, id),
  ]);

  const drafts: QuotePackageDraft[] = packagesAsDrafts(existingPackages);

  // First time: the customer's flat price becomes Option A. Pre-filled on
  // screen but read from the form, so the user can fix a guessed name (and no
  // option is ever called "null").
  if (drafts.length === 0) {
    const title = words(String(formData.get("keep_title") ?? ""), PACKAGE_TITLE_MAX);
    const amount = money(String(formData.get("keep_amount") ?? ""));
    if (!title) return { ok: false, error: "Give the quote they already have a name, so they can tell the two apart." };
    if (amount == null) return { ok: false, error: "Check the price on the option they already have." };
    drafts.push({
      title,
      description: words(String(formData.get("keep_desc") ?? ""), PACKAGE_DESC_MAX),
      amount,
      recommended: false,
    });
  }

  const title = words(String(formData.get("add_title") ?? ""), PACKAGE_TITLE_MAX);
  const amount = money(String(formData.get("add_amount") ?? ""));
  if (!title) return { ok: false, error: "Give the new option a name, e.g. \"Asphalt driveway\"." };
  if (amount == null) return { ok: false, error: "Put a price on the new option." };

  if (drafts.length >= MAX_QUOTE_PACKAGES) {
    return { ok: false, error: `A quote can offer ${MAX_QUOTE_PACKAGES} options at most. Remove one in the quote editor first.` };
  }

  drafts.push({
    title,
    description: words(String(formData.get("add_desc") ?? ""), PACKAGE_DESC_MAX),
    amount,
    recommended: false,
  });

  // At most one recommendation; "recommend" carries the card index.
  const recommend = Number(String(formData.get("recommend") ?? "-1"));
  for (const [i, d] of drafts.entries()) d.recommended = i === recommend;

  const saved = await saveQuotePackages(session, id, drafts);
  if (!saved.ok) return { ok: false, error: saved.error ?? "Could not save the new option." };

  // Same pricing as saveQuote, so the two paths can't disagree.
  const was = current.quote_amount;
  const total = allInTotal(drafts, optionsAsDrafts(existingOptions));
  const patch: Partial<Quote> = {
    quote_amount: total,
    // Restarts the customer's clock: expiry and 48h nudge count from this text.
    quote_sent_at: new Date().toISOString(),
    quote_expires_at: new Date(Date.now() + QUOTE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    quote_followup_sent_at: null,
  };
  if (current.status !== "quoted") patch.status = "quoted";

  const updated = await updateQuote(session, id, patch);
  if (!updated) return { ok: false, error: "The option was saved, but the quote could not be re-sent. Open the quote editor and send it." };

  // Feeds Quotes sent; `added` says which option arrived.
  await addEvent(session, id, "quote_revised", { from: was, to: total, added: title });

  const r = await notifyQuoteOptionAdded({
    id,
    name: current.name,
    phone: current.phone,
    public_token: current.public_token,
  }).catch((e) => ({ ok: false, provider: "unknown", detail: String(e) }) as SendResult);

  await addEvent(session, id, "quote_delivery", {
    delivered: r.ok,
    held_until: r.sendAfter ?? null,
    to: r.to ?? current.phone,
    error: r.ok ? null : (r.detail ?? null),
    option_added: title,
  }).catch(() => {});

  revalidatePath(`/crm/quotes/${id}`);
  if (current.job_token) revalidatePath(`/job/${current.job_token}`);

  return {
    ok: true,
    sent: true,
    revised: true,
    smsDelivered: r.ok,
    smsTo: r.to ?? current.phone,
    smsHeldUntil: r.held ? r.sendAfterLabel : undefined,
    smsError: r.ok || r.held ? undefined : [r.detail, r.status ? `(HTTP ${r.status})` : ""].filter(Boolean).join(" ").slice(0, 500),
  };
}
