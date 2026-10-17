"use server";

import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/crm/auth";
import { todayYmd } from "@/lib/crm/clock";
import {
  QUOTE_SECTION_FIELDS,
  QUOTE_SECTION_LABELS,
  PACKAGE_DESC_MAX,
  PACKAGE_TITLE_MAX,
  QUOTE_TTL_DAYS,
  MAX_QUOTE_PACKAGES,
  TIME_RE,
  allInTotal,
  isChoice,
  noEmDash,
  optionAmount,
  optionsTotal,
  visitDateOf,
  firstNameOf,
  parseDollars,
} from "@/lib/crm/constants";
import { STATUSES, type Status } from "@/lib/crm/env";
import { isRecordedMethod, toCents, usd, type RecordedMethod } from "@/lib/crm/fees";
import { removeQuoteFromCalendar, syncQuoteToCalendar } from "@/lib/crm/gcal";
import {
  alertOwner,
  notifyApprovalRecorded,
  notifyAssignment,
  notifyBooked,
  notifyBookingCancelled,
  notifyComplete,
  notifyCustomerRescheduled,
  notifyChangeRequested,
  notifyCustomerScheduled,
  notifyOfflineApproval,
  notifyQuoteOptionAdded,
  notifyQuoteReady,
  notifyQuoteSent,
  notifyQuoteUpdated,
  notifyVisitCancelled,
  notifyVisitConfirmed,
  notifyVisitMoved,
  type SendResult,
  sendHeldMessageNow,
} from "@/lib/crm/notify";
import {
  addEvent,
  cancelMessage,
  cancelQueuedFor,
  clearAppointment,
  cancelChange,
  confirmSchedule,
  conflictMessage,
  countJobsOn,
  findJobConflict,
  findVisitConflict,
  clearQuoteResponses,
  getMessage,
  isHeld,
  getQuote,
  getStaffById,
  lastMessageOf,
  listQuoteOptions,
  listQuotePackages,
  MAX_JOBS_PER_DAY,
  optionsAsDrafts,
  packagesAsDrafts,
  parseQuoteOptions,
  parseQuotePackages,
  recordOfflineAcceptance,
  recordChangeAgreed,
  requestChange,
  sameOptions,
  samePackages,
  saveQuoteOptions,
  saveQuotePackages,
  updateQuote,
  updateQuoteResult,
  type OptionChoice,
} from "@/lib/crm/queries";
import { jobLedger, resyncJobPaidState, settleJobIfPaid } from "@/lib/crm/payments";
import { changeOrderRefusal, jobPatchRefusal } from "@/lib/crm/permissions";
import type { Quote } from "@/lib/crm/types";
import type { QuoteOptionDraft, QuotePackageDraft } from "@/lib/crm/constants";
import type { ChangeState, FinishState, SaveState, ScheduleState } from "./types";
import { takeManualPayment } from "./manual-payment";

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

// Confirm or move the work day: the action that turns an approved job into a
// booked one (texts customer and crew, syncs the calendar). Contractors may run
// it for their own jobs (RLS in confirmSchedule).
export async function setJobDate(_prev: ScheduleState, formData: FormData): Promise<ScheduleState> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Your session expired. Please sign in again." };

  const id = String(formData.get("id") ?? "");
  const date = String(formData.get("date") ?? "").slice(0, 10);
  const time = String(formData.get("time") ?? "").slice(0, 10);
  if (!id) return { ok: false, error: "Missing job id." };

  // Only consulted when a booked day MOVES. "no" means the office already told
  // the customer. Absent (calendar drag, older form) means yes.
  const tellCustomer = String(formData.get("notify") ?? "yes") !== "no";

  const current = await getQuote(session, id);
  if (!current) return { ok: false, error: "You don't have access to this job." };

  const result = await confirmSchedule(session, id, date, time);
  if (!result.ok) return { ok: false, error: result.error ?? "Could not save that date." };
  if (result.unchanged) return { ok: true, message: "That date and time were already set." };

  const moved = Boolean(result.previous);
  await addEvent(session, id, moved ? "date_changed" : "date_confirmed", {
    from: result.previous ?? null,
    from_time: result.previousTime ?? null,
    to: date,
    to_time: time,
    ...(moved ? { notified: tellCustomer } : {}),
  });

  const info = {
    id,
    name: current.name,
    phone: current.phone,
    service: current.service,
    address: current.address,
    quote_amount: current.quote_amount,
    scheduled_date: date,
    scheduled_time: time,
    job_token: current.job_token,
  };

  const contractor = current.assigned_to ? await getStaffById(session, current.assigned_to) : null;
  if (moved) {
    if (tellCustomer) await notifyCustomerRescheduled(info, result.previous, result.previousTime).catch(() => {});
  } else await notifyCustomerScheduled(info).catch(() => {});
  await notifyBooked(info, contractor?.phone, result.previous, result.previousTime, session.staff.phone).catch(
    () => {},
  );
  await syncQuoteToCalendar(id);

  revalidatePath(`/crm/quotes/${id}`);
  revalidatePath("/crm");
  revalidatePath("/crm/calendar");
  // The contractor's job page schedules through this too.
  revalidatePath("/job/[token]", "page");
  return {
    ok: true,
    message: !moved
      ? "Date confirmed and customer texted."
      : tellCustomer
        ? "Date changed and everyone notified."
        : "Date changed. The crew was told; the customer was not texted.",
  };
}


// The customer said yes on the phone, often with a day too.
//
// Everything after approval waits on customer_response = "accepted". Without
// this the crew must chase a button press, or resend the quote, whose date
// picker starts LEAD_TIME_DAYS out, past the day already agreed.
//
// Records the approval as staff (who and how) and books the agreed day in the
// same submit, so the booking isn't forgotten. The lead-time floor deliberately
// doesn't apply: it limits what a customer requests unprompted, and the person
// entering this has just checked the crew's week. Any day from today.
export async function acceptOffline(_prev: ScheduleState, formData: FormData): Promise<ScheduleState> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Your session expired. Please sign in again." };

  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing quote id." };
  const date = String(formData.get("date") ?? "").slice(0, 10);
  const time = String(formData.get("time") ?? "").slice(0, 10);
  const booking = /^\d{4}-\d{2}-\d{2}$/.test(date);
  // "no" = they're still on the phone or asked not to be texted. Approval and
  // booking are recorded either way; this only controls the customer text.
  const tellCustomer = String(formData.get("notify") ?? "yes") !== "no";

  const current = await getQuote(session, id);
  if (!current) return { ok: false, error: "You don't have access to this quote." };

  // Optional-line answers, in the option builder's JSON shape. Only uuid keys
  // with a real answer survive.
  const choices: Record<string, OptionChoice> = {};
  try {
    const raw = JSON.parse(String(formData.get("options") ?? "{}")) as Record<string, unknown>;
    for (const [key, value] of Object.entries(raw)) {
      if (!/^[0-9a-f-]{36}$/i.test(key)) continue;
      if (value === "accepted" || value === "declined") choices[key] = value;
    }
  } catch {
    return { ok: false, error: "Could not read the line item answers. Reload the page and try again." };
  }

  // Check the day BEFORE writing the approval: to the user it's one action, and
  // a clash found afterwards would leave it approved with the error lost.
  if (booking) {
    if (!TIME_RE.test(time.trim())) return { ok: false, error: "Pick the start time you agreed on." };
    if (date < todayYmd()) return { ok: false, error: "That day has already passed. Pick today or later." };
    if ((await countJobsOn(date, id)) >= MAX_JOBS_PER_DAY) {
      return { ok: false, error: "Another job is already booked that day. Record the approval without a date, or agree another day." };
    }
    const clash = await findJobConflict(current.assigned_to, date, id);
    if (clash) return { ok: false, error: conflictMessage(clash) };
  }

  // Package id, if a choice was offered; refused downstream if missing. No default.
  const packageId = String(formData.get("package") ?? "").trim();

  const recorded = await recordOfflineAcceptance(session, id, {
    options: choices,
    packageId: /^[0-9a-f-]{36}$/i.test(packageId) ? packageId : undefined,
    agreedDate: booking ? date : null,
    agreedTime: booking ? time : null,
  });
  if (!recorded.ok) return { ok: false, error: recorded.error ?? "Could not record that approval." };

  // The chosen package leads the list: "approved - $8,500" doesn't say what to
  // load the truck with.
  const pick = recorded.package;
  const chosen = {
    accepted: [
      ...(pick ? [{ title: pick.title, amount: optionAmount(pick) }] : []),
      ...(recorded.accepted ?? []).map((o) => ({ title: o.title, amount: optionAmount(o) })),
    ],
    declined: (recorded.declined ?? []).map((o) => ({ title: o.title, amount: optionAmount(o) })),
  };
  // The row's new figure (package/options may reprice it), quoted in every message below.
  const amount =
    pick || (recorded.accepted && recorded.accepted.length > 0)
      ? Math.round(
          ((pick ? optionAmount(pick) : 0) + optionsTotal(recorded.accepted ?? [])) * 100,
        ) / 100
      : current.quote_amount;

  await addEvent(session, id, "customer_accepted", {
    // Marks it as staff-recorded from a call, so the activity log never claims
    // the customer clicked.
    channel: "phone",
    recorded_by: session.staff.full_name || session.staff.email || "Staff",
    preferred_dates: booking ? [date] : null,
    preferred_times: booking ? [time] : null,
    chosen_package: pick?.title ?? null,
    accepted_options: (recorded.accepted ?? []).map((o) => o.title),
    declined_options: (recorded.declined ?? []).map((o) => o.title),
    total: amount ?? null,
  });

  const contractor = current.assigned_to ? await getStaffById(session, current.assigned_to) : null;
  const info = {
    id,
    name: current.name,
    phone: current.phone,
    service: current.service,
    address: current.address,
    quote_amount: amount,
    job_token: current.job_token,
    public_token: current.public_token,
    preferred_dates: booking ? [date] : null,
    preferred_times: booking ? [time] : null,
    chosen,
  };

  let booked = false;
  // Why the requested day didn't take. Conflicts were ruled out up front, so
  // this is the DB refusing; the crew must hear it with "approval recorded".
  let bookingError: string | null = null;
  const withDate = { ...info, scheduled_date: booking ? date : null, scheduled_time: booking ? time : null };
  if (booking) {
    // Same call as the schedule card, so texts, calendar and reminders match.
    const result = await confirmSchedule(session, id, date, time);
    if (result.ok && !result.unchanged) {
      booked = true;
      await addEvent(session, id, "date_confirmed", { from: null, from_time: null, to: date, to_time: time });
      if (tellCustomer) await notifyCustomerScheduled(withDate).catch(() => {});
      await notifyBooked(withDate, contractor?.phone, null, null, session.staff.phone).catch(() => {});
      await syncQuoteToCalendar(id);
    } else if (!result.ok) {
      bookingError = result.error ?? "the date could not be saved";
    }
  }

  // The office always hears it came by phone, even when booked too: JOB BOOKED
  // alone reads like the customer tapped the link.
  await notifyOfflineApproval(booked ? withDate : info, contractor?.phone, {
    recordedBy: session.staff.full_name || session.staff.email || "a teammate",
    actorPhone: session.staff.phone,
    booked,
  }).catch(() => {});

  // Skipped when booked: notifyCustomerScheduled covered both halves.
  if (tellCustomer && !booked) await notifyApprovalRecorded(info).catch(() => {});

  revalidatePath(`/crm/quotes/${id}`);
  revalidatePath("/crm");
  revalidatePath("/crm/calendar");
  revalidatePath("/job/[token]", "page");

  // Never an error (the approval is written), but a requested day that didn't
  // book must be said where the user is looking.
  if (bookingError) {
    return { ok: true, message: `Approval recorded, but the day was NOT booked: ${bookingError} Set it on the schedule card below.` };
  }
  const texted = tellCustomer ? " The customer has been texted." : "";
  return {
    ok: true,
    message: booked
      ? `Approval recorded and the day is booked.${texted}`
      : `Approval recorded and the job is ready to schedule.${texted}`,
  };
}


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

// An online request carries a slot the customer offered in case photos aren't
// enough; this is the crew taking it up. It flips the request to in-person,
// which is the point: calendar, invites, reminders and the job page key off
// quote_type to decide whether a date means someone is expected.
export async function confirmVisit(_prev: ScheduleState, formData: FormData): Promise<ScheduleState> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Your session expired. Please sign in again." };

  const id = String(formData.get("id") ?? "");
  const date = String(formData.get("date") ?? "").slice(0, 10);
  const rawTime = String(formData.get("time") ?? "").slice(0, 20);
  if (!id) return { ok: false, error: "Missing job id." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "Pick a date for the visit." };
  // Any well-formed time, not the public form's slot list: the crew fit visits
  // around a real day. Normalised like confirmSchedule so "9:00 am" and
  // "9:00 AM" don't diverge.
  if (!TIME_RE.test(rawTime)) return { ok: false, error: "Pick a time for the visit." };
  const time = rawTime.trim().toUpperCase().replace(/\s+/, " ");
  // Only for moving an existing visit (see setJobDate); a first confirmation
  // always texts, since that's how they find out.
  const tellCustomer = String(formData.get("notify") ?? "yes") !== "no";

  const current = await getQuote(session, id);
  if (!current) return { ok: false, error: "You don't have access to this job." };

  // The assignee must actually be free; this is when an offered slot becomes a
  // commitment. No per-day cap (visits stack an hour apart), and the crew
  // aren't held to their Settings window here.
  const clash = await findVisitConflict(current.assigned_to, date, time, id);
  if (clash) return { ok: false, error: conflictMessage(clash) };

  const wasOnline = current.quote_type === "online";
  // Did they already have an appointment? An online row's date was only
  // offered, so only in-person counts. Confirming introduces the visit; moving
  // says only what changed, so a reschedule doesn't read as a second booking.
  const hadAppointment = Boolean(visitDateOf(current));
  const movedOff = current.visit_date !== date || (current.visit_time ?? "") !== time;

  // Re-confirming the same slot isn't news; nobody is texted.
  if (hadAppointment && !movedOff) {
    return { ok: true, message: "That was already the visit day and time. Nobody was texted." };
  }

  const { quote: updated, error } = await updateQuoteResult(session, id, {
    quote_type: "inperson",
    visit_date: date,
    visit_time: time,
    // Re-arm night-before reminders, as confirmSchedule does for work days.
    visit_reminder_sent_at: null,
    visit_crew_reminded_at: null,
  });
  if (!updated) return { ok: false, error: error ?? "Could not confirm that visit." };

  await addEvent(session, id, hadAppointment ? "visit_moved" : "visit_confirmed", {
    to: date,
    to_time: time,
    ...(hadAppointment
      ? { from: current.visit_date ?? null, from_time: current.visit_time ?? null, notified: tellCustomer }
      : { requested: current.visit_date ?? null, requested_time: current.visit_time ?? null, moved: movedOff }),
  });

  // The assignee is texted, not whoever clicked (same person only on the job page).
  const crew = current.assigned_to ? await getStaffById(session, current.assigned_to) : null;
  const info = {
    id,
    name: current.name,
    phone: current.phone,
    service: current.service,
    address: current.address,
    quote_type: "inperson",
    visit_date: date,
    visit_time: time,
    job_token: current.job_token,
  };

  if (hadAppointment) {
    // Only what changed. Crew and office are told too, since the calendar can
    // move a visit out from under the driver.
    await notifyVisitMoved(info, current.visit_date, current.visit_time, {
      crewPhone: crew?.phone ?? null,
      crewName: crew?.full_name ?? null,
      movedBy: session.staff.full_name,
      actorPhone: session.staff.phone,
      tellCustomer,
    }).catch(() => {});
  } else {
    await notifyVisitConfirmed(
      info,
      // Nobody assigned, nobody to tell; the owner alert covers it.
      crew?.phone ?? null,
      crew?.full_name ?? session.staff.full_name,
      // What they asked for, so the text can own up to a different slot.
      { date: current.visit_date, time: current.visit_time },
      // Read before the update flipped it: an online conversion is a different story.
      wasOnline,
      session.staff.phone,
    ).catch(() => {});
  }
  await syncQuoteToCalendar(id);

  revalidatePath(`/crm/quotes/${id}`);
  revalidatePath("/crm");
  revalidatePath("/crm/calendar");
  revalidatePath("/job/[token]", "page");
  return {
    ok: true,
    message: hadAppointment
      ? tellCustomer
        ? "Visit moved. The customer has been texted the new day, and so has the crew."
        : "Visit moved. The crew was told; the customer was not texted."
      : movedOff
        ? "Visit confirmed for the new day. The customer and the crew have been texted."
        : "Visit confirmed. The customer and the crew have been texted.",
  };
}

/**
 * Call off an appointment (work day or quote visit), not the lead. A work day
 * drops back to Needs scheduling; a visit's date is cleared. Removing the lead
 * is the pipeline's Delete (archive, undoable).
 *
 * `notify` defaults on: usually we can't make it and they expect us. Off when
 * the customer asked and you're on the phone with them.
 *
 * One shared action for all three screens, so no cancel path forgets to text.
 */
export async function cancelAppointment(_prev: ScheduleState, formData: FormData): Promise<ScheduleState> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Your session expired. Please sign in again." };

  const id = String(formData.get("id") ?? "");
  const kind = String(formData.get("kind") ?? "") === "job" ? "job" : "visit";
  const notify = String(formData.get("notify") ?? "yes") !== "no";
  // Whether the CUSTOMER asked: receipt vs apology, and the reason in the crew's copy.
  const asked = String(formData.get("asked") ?? "") === "yes";
  if (!id) return { ok: false, error: "Missing appointment." };

  const current = await getQuote(session, id);
  if (!current) return { ok: false, error: "You don't have access to this job." };

  // Nothing booked usually means a double cancel or a stale page; not an error.
  const had = kind === "job" ? current.scheduled_date : visitDateOf(current);
  if (!had) return { ok: true, message: "That appointment was already cancelled. Nobody was texted." };

  const result = await clearAppointment(session, id, kind);
  if (!result.ok) return { ok: false, error: result.error ?? "Could not cancel that appointment." };

  await addEvent(session, id, kind === "job" ? "booking_cancelled" : "visit_cancelled", {
    from: result.previous ?? null,
    from_time: result.previousTime ?? null,
    notified: notify,
  });

  // The crew hears either way; `notify` only concerns the customer.
  const crew = current.assigned_to ? await getStaffById(session, current.assigned_to) : null;
  const info = {
    id,
    name: current.name,
    phone: current.phone,
    service: current.service,
    address: current.address,
    visit_date: result.previous,
    visit_time: result.previousTime,
    job_token: current.job_token,
  };
  const team = {
    asked,
    tellCustomer: notify,
    crewPhone: crew?.phone ?? null,
    cancelledBy: session.staff.full_name,
    actorPhone: session.staff.phone,
  };

  if (kind === "job") await notifyBookingCancelled(info, result.previous, result.previousTime, team).catch(() => {});
  else await notifyVisitCancelled(info, team).catch(() => {});

  await removeQuoteFromCalendar(id);

  revalidatePath(`/crm/quotes/${id}`);
  revalidatePath("/crm");
  revalidatePath("/crm/calendar");
  revalidatePath("/job/[token]", "page");
  return {
    ok: true,
    message:
      kind === "job"
        ? `Date released. ${current.name} is back in Needs scheduling${notify ? " and was texted." : "."}`
        : `Visit cancelled${notify ? " and the customer was texted." : "."}`,
  };
}

// Marks on-site work done: Completed, plus a thank-you with the review link.
// Returns state so the photo requirement can say why it refused.
export async function completeJob(_prev: FinishState, formData: FormData): Promise<FinishState> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Your session expired. Please sign in again." };
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing job id." };

  const current = await getQuote(session, id);
  if (!current) return { ok: false, error: "You don't have access to this job." };
  if (current.status === "completed" || current.status === "paid") {
    return { ok: true, message: "This job is already closed out." };
  }

  // Before/after photos are the handover record. Enforced here, since the CRM
  // reaches this action too.
  const missing: string[] = [];
  if (!current.before_urls?.length) missing.push("before");
  if (!current.after_urls?.length) missing.push("after");
  if (missing.length > 0) {
    return {
      ok: false,
      error:
        missing.length === 2
          ? "Upload before and after photos before closing this job out."
          : `Upload ${missing[0]} photos before closing this job out.`,
    };
  }

  // Crew checklist and note; optional (the CRM's button sends neither), but
  // recorded and passed on when present.
  const checks = formData.getAll("check").map((c) => String(c)).slice(0, 8);
  const note = String(formData.get("note") ?? "").trim().slice(0, 1000);

  const updated = await updateQuote(session, id, { status: "completed", completed_at: new Date().toISOString() });
  if (!updated) return { ok: false, error: "Could not close this job out. Please try again." };

  await addEvent(session, id, "status_changed", { from: current.status, to: "completed" });
  await addEvent(session, id, "job_completed", { checks, note: note || null });
  await notifyComplete({ id, name: current.name, phone: current.phone }).catch(() => {});
  await alertOwner(
    [
      "JOB COMPLETED",
      "",
      "Customer:",
      current.name,
      "",
      "Completed by:",
      session.staff.full_name || "crew",
      // The crew's note is why anyone reads this, so it goes above the next-step line.
      ...(note ? ["", "Note from the crew:", note] : []),
      "",
      "Request payment when you're ready.",
    ].join("\n"),
    session.staff.phone,
  ).catch(() => {});

  // Money arriving can't skip close-out, so a fully paid job waits on paid_at
  // until now. It can move to Paid.
  await settleJobIfPaid(id).catch(() => {});

  revalidatePath(`/crm/quotes/${id}`);
  revalidatePath("/crm");
  // The crew mark jobs done from their job page.
  revalidatePath("/job/[token]", "page");
  return { ok: true, message: "Job closed out and the customer has been thanked." };
}


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

// Texts that carry the quote itself; cancelling one cancels the quote.
const QUOTE_TEXT_KINDS = new Set(["quote_ready", "quote_updated"]);

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

/**
 * Mark a lead as practice, or unmark it. Real test payments go through real
 * code, so the flag keeps them off the Money page's figures; the lead
 * otherwise behaves normally. Owner only: a real job marked practice is
 * revenue that stops counting.
 */
export async function setTestFlag(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session || session.staff.role !== "owner") return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const current = await getQuote(session, id);
  if (!current) return;

  const isTest = String(formData.get("isTest") ?? "") === "1";
  const updated = await updateQuote(session, id, { is_test: isTest });
  if (!updated) return;

  await addEvent(session, id, isTest ? "marked_test" : "unmarked_test");

  revalidatePath(`/crm/quotes/${id}`);
  revalidatePath("/crm");
  revalidatePath("/crm/money");
}

// Regenerate the customer and contractor tokens after a leak: old /q/ and /job/
// URLs stop resolving at once; re-text the new customer link.
export async function rotateTokens(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const current = await getQuote(session, id);
  if (!current) return;

  const patch: Partial<Quote> = {
    public_token: crypto.randomUUID().replace(/-/g, ""),
    job_token: crypto.randomUUID().replace(/-/g, ""),
  };
  const updated = await updateQuote(session, id, patch);
  if (!updated) return;

  await addEvent(session, id, "links_rotated");

  revalidatePath(`/crm/quotes/${id}`);
  revalidatePath("/crm");
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
