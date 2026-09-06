"use server";

import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/crm/auth";
import {
  QUOTE_SECTION_FIELDS,
  QUOTE_SECTION_LABELS,
  QUOTE_TTL_DAYS,
  TIME_RE,
  noEmDash,
  optionsTotal,
  visitDateOf,
} from "@/lib/crm/constants";
import { STATUSES, type Status } from "@/lib/crm/env";
import { removeQuoteFromCalendar, syncQuoteToCalendar } from "@/lib/crm/gcal";
import {
  alertOwner,
  notifyAssignment,
  notifyBooked,
  notifyBookingCancelled,
  notifyComplete,
  notifyCustomerRescheduled,
  notifyCustomerScheduled,
  notifyQuoteReady,
  notifyQuoteSent,
  notifyQuoteUpdated,
  notifyVisitCancelled,
  notifyVisitConfirmed,
  notifyVisitMoved,
  type SendResult,
} from "@/lib/crm/notify";
import {
  addEvent,
  clearAppointment,
  confirmSchedule,
  conflictMessage,
  findJobConflict,
  findVisitConflict,
  getQuote,
  getStaffById,
  lastMessageOf,
  listQuoteOptions,
  optionsAsDrafts,
  parseQuoteOptions,
  sameOptions,
  saveQuoteOptions,
  updateQuote,
  updateQuoteResult,
} from "@/lib/crm/queries";
import { settleJobIfPaid } from "@/lib/crm/payments";
import type { Quote } from "@/lib/crm/types";
import type { QuoteOptionDraft } from "@/lib/crm/constants";
import type { FinishState, SaveState, ScheduleState } from "./types";

export async function saveQuote(_prev: SaveState, formData: FormData): Promise<SaveState> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Your session expired. Please sign in again." };

  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing quote id." };

  const current = await getQuote(session, id);
  if (!current) return { ok: false, error: "You don't have access to this quote." };

  const isOwner = session.staff.role === "owner";
  // "resend" is a deliberate second send and only an owner can ask for it; it
  // otherwise behaves exactly like "send".
  const intent = String(formData.get("intent") ?? "");
  const sending = intent === "send" || intent === "resend";
  const patch: Partial<Quote> = {};
  const events: { type: string; meta?: Record<string, unknown> }[] = [];
  // Whether this save changes anything the customer would actually read: the
  // price, one of the five sections, or an older quote's free text. It is what
  // separates a correction from a second copy of the same quote further down.
  let contentChanged = false;
  // Set at send time: this send replaces a quote the customer already has and
  // hasn't answered. Read again after the save to pick the customer's text.
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

  // Assignment (owner only)
  if (isOwner && formData.has("assigned_to")) {
    const raw = String(formData.get("assigned_to") ?? "").trim();
    const next = raw === "" ? null : raw;
    if (next !== current.assigned_to) {
      // Moving a job that already has a date onto somebody else puts a date on
      // THEIR calendar, so it is a booking and has to clear the same checks a
      // booking does. It didn't, which was the one way left to double-book a
      // contractor: every other path picks a date for a known person, and this
      // one picks a person for a known date.
      //
      // Both appointments are tested, because a row can be carrying a booked
      // work day and a quote visit at once and neither may land on top of
      // something the new assignee already has.
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

  // Line items. A quote is either one price or a list of things the customer
  // answers one at a time, and this is where the second shape arrives: both
  // editors post the whole list as JSON, and it replaces whatever is stored.
  //
  // Locked once they've answered. The rows carry their own accepted/declined
  // stamps by then - the record of what was actually bought - and rewriting
  // them would quietly change what a finished job says it included.
  const existingOptions = await listQuoteOptions(session, id);
  let optionRows: QuoteOptionDraft[] | null = null;
  if (formData.has("options_json") && !current.customer_response) {
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

  // What this quote is worth, and where that number comes from.
  //
  // With line items the price is the sum of them, full stop. The editors show
  // that total in the amount field so the two can't disagree on screen, but the
  // figure the browser posted is never what gets saved - a stale form would
  // otherwise undo a line item somebody had just added.
  //
  // Only while the offer is still open. Once the customer has answered, the
  // price is what THEY picked - required items plus the extras they said yes
  // to - and re-deriving it from every row on the quote would quietly bill
  // them for the sidewalk they turned down.
  const effectiveOptions = optionRows ?? optionsAsDrafts(existingOptions);
  const itemised = effectiveOptions.length > 0 && !current.customer_response;

  if (itemised) {
    const total = optionsTotal(effectiveOptions);
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

  // Customer name. Free text from a phone call or a web form, so it arrives
  // wrong often enough to need fixing - and it is the name every later text
  // opens with, so a typo here follows the customer through the whole job.
  if (formData.has("name")) {
    const v = String(formData.get("name") ?? "").trim().slice(0, 120);
    if (v.length < 2) return { ok: false, error: "Enter the customer's name." };
    if (v !== current.name) {
      patch.name = v;
      events.push({ type: "name_changed", meta: { from: current.name, to: v } });
    }
  }

  // Customer-facing summary. Superseded by the five sections below, still
  // saved so an older quote can be edited without losing its body.
  if (formData.has("quote_summary")) {
    const v = noEmDash(String(formData.get("quote_summary") ?? "").trim()).slice(0, 4000);
    patch.quote_summary = v || null;
    if (patch.quote_summary !== current.quote_summary) {
      contentChanged = true;
      events.push({ type: "summary_changed" });
    }
  }

  // The five sections the customer reads. Any one may say "Not applicable",
  // but none may be blank on a quote that goes out - that check is at send
  // time below, so a half-written quote can still be saved as a draft.
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

  // "Send Quote": make the customer link live and text it to them. Price and a
  // customer-facing description are both required.
  // What the customer will actually see: this save's values where it changed
  // them, the stored ones otherwise. Declared out here because the texts sent
  // further down report the same figure the customer was quoted.
  const effectiveAmount =
    itemised
      ? optionsTotal(effectiveOptions)
      : patch.quote_amount !== undefined
        ? patch.quote_amount
        : current.quote_amount;
  const effectiveSummary = patch.quote_summary !== undefined ? patch.quote_summary : current.quote_summary;

  if (sending) {
    if (itemised && optionsTotal(effectiveOptions) <= 0) {
      return { ok: false, error: "Put a price on at least one line item before sending." };
    }
    if (effectiveAmount == null) return { ok: false, error: "Set a quote amount before sending." };

    // Every section has to say something. "Not applicable" counts - a slab
    // with no permit and nothing to demolish is a real answer, and saying so
    // is what stops the customer wondering what was left out. A quote sent
    // before the sections existed passes on its old summary instead, so an
    // owner re-sending an old quote isn't forced to rewrite it.
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

    // A second send to a customer who hasn't answered yet is one of two
    // opposite things, and telling them apart is the whole rule:
    //
    //   a correction  the price was wrong, or the scope was, and the figure on
    //                 their phone is one nobody wants them approving. It is new
    //                 information, it goes out under its own message, and the
    //                 crew who wrote the quote can send it themselves - waiting
    //                 on the office while a wrong number sits in the customer's
    //                 thread is how a bad quote gets accepted.
    //
    //   a duplicate   the same quote again, which carries nothing the first
    //                 didn't. That's what the block below is for.
    revising = Boolean(current.quote_sent_at) && !current.customer_response && contentChanged;

    // One quote text, then wait for an answer.
    //
    // Nothing visible happens on this page when a text goes out, so the natural
    // response to uncertainty is to press Send again. Ten identical texts is how
    // that looks from the customer's phone, and not one of them carries any
    // information the first didn't. The customer reads it as disorganised at the
    // exact moment they're deciding whether to hand over thousands of dollars.
    //
    // Four things mean the block would be wrong, so each lifts it:
    //   - they've replied, so this is a revised quote rather than a repeat
    //   - the quote itself changed, so this is the correction described above
    //   - the last text never left the building, so nothing was delivered
    //   - an owner deliberately asked to send it again
    if (current.quote_sent_at && !current.customer_response && !revising) {
      const last = await lastMessageOf(session, id, "quote_ready");
      // No log row (or the table isn't there yet) is treated as delivered: the
      // safe default when we can't tell is not to text them twice.
      const reached = last ? last.ok : true;
      if (reached && !(intent === "resend" && isOwner)) {
        return {
          ok: false,
          error: `${current.name.trim().split(/\s+/)[0] || "The customer"} was already texted this quote and hasn't replied yet, so it won't send twice. If the quote itself was wrong, change the price or the wording and it goes out as a correction. If they say it never arrived, the owner can send it again.`,
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
      // A correction restarts the customer's clock. The quote they hold is this
      // one, so the 48-hour nudge should count from this text rather than from
      // the version it replaced - and a lead already nudged once gets a fresh
      // window instead of never being followed up on the new price.
      patch.quote_sent_at = new Date().toISOString();
      patch.quote_followup_sent_at = null;
    }
    // The link is good for seven days from THIS send. Re-stamped on every
    // send, not just the first, so re-sending is what revives an expired
    // quote - which is the whole recovery path for one that ran out.
    patch.quote_expires_at = new Date(Date.now() + QUOTE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    events.push(
      revising
        ? { type: "quote_revised", meta: { from: current.quote_amount, to: effectiveAmount } }
        : { type: "quote_sent" },
    );
  }

  if (!sending && Object.keys(patch).length === 0 && !optionRows) return { ok: true };

  try {
    // Line items first: the price on the row below is derived from them, so a
    // failure here has to stop the save rather than leave a total with nothing
    // behind it.
    if (optionRows) {
      const saved = await saveQuoteOptions(session, id, optionRows);
      if (!saved.ok) return { ok: false, error: saved.error ?? "Could not save the line items." };
    }

    if (Object.keys(patch).length > 0) {
      const updated = await updateQuote(session, id, patch);
      if (!updated) return { ok: false, error: "Could not save. Check your access and try again." };
    }

    for (const e of events) await addEvent(session, id, e.type, e.meta);

    // Texts: alert a newly-assigned contractor, and owners on every change (the
    // acting user is excluded so they aren't texted about their own edits).
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
          // Without quote_type the message can't tell a booked visit from a
          // slot an online customer merely offered, and would announce both.
          quote_type: current.quote_type,
          visit_date: current.visit_date,
          visit_time: current.visit_time,
          job_token: current.job_token,
        },
        contractor?.full_name,
      ).catch(() => {});
      // No owner text here: whoever assigned it is the one who'd be notified.
      // Invite the newly-assigned contractor on Google Calendar (if dated).
      await syncQuoteToCalendar(id);
    }
    // Marking the job Completed here (via the status dropdown) also thanks the customer.
    if (patch.status === "completed" && current.status !== "completed") {
      await notifyComplete({ id, name: current.name, phone: current.phone }).catch(() => {});
    }

    let smsDelivered = false;
    let smsError: string | undefined;
    let smsHeldUntil: string | undefined;
    let smsTo: string | undefined;
    if (sending) {
      // Deliberately not swallowed: the whole point of this button is that the
      // customer receives something, so a failure has to reach the screen with
      // the provider's own reason rather than a silent false.
      // Same link either way - the quote page renders the current row, so the
      // text they already have shows the corrected quote - but a correction
      // says so rather than arriving as a second "your quote is ready".
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
      // The quote is recorded as sent either way - it genuinely was marked sent
      // and the link is live - but the log keeps whether it actually reached
      // them, so a silent texting outage is visible afterwards.
      await addEvent(session, id, "quote_delivery", {
        delivered: r.ok,
        held_until: r.sendAfter ?? null,
        to: smsTo,
        error: smsError ?? null,
        revised: revising,
      }).catch(() => {});

      // Tell the office it's out and the sender that it landed. Deliberately
      // after the delivery result, so neither message claims a send that failed
      // - and the whole result goes over, not just `ok`, so a text quiet hours
      // are holding reads as queued rather than as a failure to chase.
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
    // Contractors quote from their own job page, so it has to pick up the new
    // price and status too.
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

// Confirm the work day, or move it. This is the one action that turns an
// approved job into a booked one: it texts the customer their date (or that it
// moved), tells the crew, and syncs the calendar. Contractors can run it for
// their own assigned jobs - RLS in confirmSchedule enforces that - which is what
// lets the crew settle a date without waiting on the owner.
export async function setJobDate(_prev: ScheduleState, formData: FormData): Promise<ScheduleState> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Your session expired. Please sign in again." };

  const id = String(formData.get("id") ?? "");
  const date = String(formData.get("date") ?? "").slice(0, 10);
  const time = String(formData.get("time") ?? "").slice(0, 10);
  if (!id) return { ok: false, error: "Missing job id." };

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
  if (moved) await notifyCustomerRescheduled(info, result.previous, result.previousTime).catch(() => {});
  else await notifyCustomerScheduled(info).catch(() => {});
  await notifyBooked(info, contractor?.phone, result.previous, result.previousTime, session.staff.phone).catch(
    () => {},
  );
  await syncQuoteToCalendar(id);

  revalidatePath(`/crm/quotes/${id}`);
  revalidatePath("/crm");
  revalidatePath("/crm/calendar");
  // The contractor's own job page schedules through this action too.
  revalidatePath("/job/[token]", "page");
  return { ok: true, message: moved ? "Date changed and everyone notified." : "Date confirmed and customer texted." };
}

// An online request arrives with a slot the customer offered in case their job
// turns out to be too big to price from photos. Until now that offer sat there
// as a maybe. This is the crew taking it up.
//
// Confirming flips the request to in-person, and that flip is the point: every
// other surface - the calendar, Google invites, crew reminders, the job page
// headline - keys off quote_type to decide whether a date means "somebody is
// expected here". One column change turns the whole system on for this job,
// and until it happens nothing tells anyone to drive anywhere.
export async function confirmVisit(_prev: ScheduleState, formData: FormData): Promise<ScheduleState> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Your session expired. Please sign in again." };

  const id = String(formData.get("id") ?? "");
  const date = String(formData.get("date") ?? "").slice(0, 10);
  const rawTime = String(formData.get("time") ?? "").slice(0, 20);
  if (!id) return { ok: false, error: "Missing job id." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "Pick a date for the visit." };
  // Not held to the public form's fixed slot list - a contractor confirming a
  // visit needs to fit it around a real day, so any well-formed time is fine.
  // Normalised the same way confirmSchedule does its start time: the fixed
  // slot list used to guarantee one canonical spelling, and without it "9:00
  // am" and "9:00 AM" would be two different strings in the same column.
  if (!TIME_RE.test(rawTime)) return { ok: false, error: "Pick a time for the visit." };
  const time = rawTime.trim().toUpperCase().replace(/\s+/, " ");

  const current = await getQuote(session, id);
  if (!current) return { ok: false, error: "You don't have access to this job." };

  // Whoever this job belongs to has to actually be free. Confirming here is the
  // moment an offered slot becomes somewhere a person has to be, so it's the
  // moment to find out they're already booked - not on the morning.
  //
  // There is no per-day cap to check any more: visits stack an hour apart, so
  // the only thing that can be full is the one person's day, and that is
  // exactly what this asks. A contractor is still not held to their own
  // Settings window here - they need to fit a visit around a real day.
  const clash = await findVisitConflict(current.assigned_to, date, time, id);
  if (clash) return { ok: false, error: conflictMessage(clash) };

  const wasOnline = current.quote_type === "online";
  // Did this customer already have an appointment? An online request's date is
  // a slot they offered, not one we took, so only an in-person row counts.
  //
  // This is the difference between confirming and moving, and the customer
  // hears about it very differently. Confirming introduces the visit: why
  // we're coming, when, that it's free. Moving assumes all of that and says
  // the one thing that changed. Sending the confirmation twice - which is what
  // this action used to do when the crew hit Reschedule - reads as a second
  // appointment being announced on top of the first.
  const hadAppointment = Boolean(visitDateOf(current));
  const movedOff = current.visit_date !== date || (current.visit_time ?? "") !== time;

  // Re-confirming the day it is already on is not news. Nothing has changed for
  // the customer, so nothing is sent to them: a text saying the appointment
  // they already have is still the appointment they have is the same text
  // twice, however it's worded.
  if (hadAppointment && !movedOff) {
    return { ok: true, message: "That was already the visit day and time. Nobody was texted." };
  }

  const { quote: updated, error } = await updateQuoteResult(session, id, {
    quote_type: "inperson",
    visit_date: date,
    visit_time: time,
    // A confirmed (or moved) visit gets its own night-before reminders, the
    // same way confirmSchedule re-arms the crew countdown for a work day.
    visit_reminder_sent_at: null,
    visit_crew_reminded_at: null,
  });
  if (!updated) return { ok: false, error: error ?? "Could not confirm that visit." };

  await addEvent(session, id, hadAppointment ? "visit_moved" : "visit_confirmed", {
    to: date,
    to_time: time,
    ...(hadAppointment
      ? { from: current.visit_date ?? null, from_time: current.visit_time ?? null }
      : { requested: current.visit_date ?? null, requested_time: current.visit_time ?? null, moved: movedOff }),
  });

  // Whoever the job belongs to gets the text, not whoever happened to click. On
  // the crew's own job page these are the same person; from the CRM they aren't.
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
    // Moving one they already have: what changed, and nothing else. The crew
    // and the office are told separately, because the calendar can move a
    // visit out from under whoever has to drive to it.
    await notifyVisitMoved(info, current.visit_date, current.visit_time, {
      crewPhone: crew?.phone ?? null,
      crewName: crew?.full_name ?? null,
      movedBy: session.staff.full_name,
      actorPhone: session.staff.phone,
    }).catch(() => {});
  } else {
    await notifyVisitConfirmed(
      info,
      // Nobody assigned means nobody to tell. It used to fall back to the
      // person clicking, which texted them the visit they were in the middle
      // of booking; the owner alert already covers an unassigned job.
      crew?.phone ?? null,
      crew?.full_name ?? session.staff.full_name,
      // What they originally asked for, so the customer text can own up to it if
      // the crew put them on a different day.
      { date: current.visit_date, time: current.visit_time },
      // Read before the update above flipped it. An in-person request being given
      // a date is not the same story as an online one being converted.
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
      ? "Visit moved. The customer has been texted the new day, and so has the crew."
      : movedOff
        ? "Visit confirmed for the new day. The customer and the crew have been texted."
        : "Visit confirmed. The customer and the crew have been texted.",
  };
}

/**
 * Call off an appointment: a booked work day, or a quote visit.
 *
 * Cancels the APPOINTMENT, not the lead. The customer stays in the pipeline
 * with everything on them intact - a work day drops back to Needs scheduling
 * so it can be rebooked, a visit's date is simply cleared. Getting rid of the
 * lead itself is still the pipeline's Delete, which archives it and can be
 * undone.
 *
 * `notify` defaults to on, because the usual reason to cancel is that we can't
 * make it and they're expecting us. It comes off when the customer is the one
 * who asked and you're already on the phone with them - a text telling somebody
 * what they just said is noise.
 *
 * Lives here with setJobDate and confirmVisit rather than with the calendar
 * that first grew it: it is now reached from three screens, and two ways to
 * cancel the same appointment is how one of them ends up not texting anybody.
 */
export async function cancelAppointment(_prev: ScheduleState, formData: FormData): Promise<ScheduleState> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Your session expired. Please sign in again." };

  const id = String(formData.get("id") ?? "");
  const kind = String(formData.get("kind") ?? "") === "job" ? "job" : "visit";
  const notify = String(formData.get("notify") ?? "yes") !== "no";
  // Whether the CUSTOMER asked for this. It decides whether their text is a
  // receipt or an apology, and it is what the crew's copy names as the reason.
  const asked = String(formData.get("asked") ?? "") === "yes";
  if (!id) return { ok: false, error: "Missing appointment." };

  const current = await getQuote(session, id);
  if (!current) return { ok: false, error: "You don't have access to this job." };

  // Nothing booked is not a failure worth an error box - it usually means two
  // people cancelled the same appointment, or the page has been open a while.
  const had = kind === "job" ? current.scheduled_date : visitDateOf(current);
  if (!had) return { ok: true, message: "That appointment was already cancelled. Nobody was texted." };

  const result = await clearAppointment(session, id, kind);
  if (!result.ok) return { ok: false, error: result.error ?? "Could not cancel that appointment." };

  await addEvent(session, id, kind === "job" ? "booking_cancelled" : "visit_cancelled", {
    from: result.previous ?? null,
    from_time: result.previousTime ?? null,
    notified: notify,
  });

  // The crew hears either way. `notify` is about the customer - whether to text
  // somebody you may have just put the phone down on - and has never had
  // anything to do with whether the person driving there finds out.
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

// Contractor/owner marks the on-site work done. Moves it to Completed and texts
// the customer a thank-you with the review link. Payment is the next step.
//
// Returns state rather than void so the photo requirement below can say why it
// refused. A silent no-op on a button that texts the customer is the worst of
// both worlds: nothing happens and nobody knows why.
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

  // Before and after are the record of what was handed over, so the job
  // cannot close without them. Enforced here rather than only in the UI:
  // this action is reachable from the CRM too, and a rule that only exists
  // in one of two buttons is not a rule.
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

  // The crew's close-out checklist and any note they left. Optional: the owner's
  // own Mark completed button on the CRM page sends neither, and shouldn't have
  // to. What matters is that when they ARE sent, they're recorded and they reach
  // whoever has to act on them.
  const checks = formData.getAll("check").map((c) => String(c)).slice(0, 8);
  const note = String(formData.get("note") ?? "").trim().slice(0, 1000);

  const updated = await updateQuote(session, id, { status: "completed", completed_at: new Date().toISOString() });
  if (!updated) return { ok: false, error: "Could not close this job out. Please try again." };

  await addEvent(session, id, "status_changed", { from: current.status, to: "completed" });
  await addEvent(session, id, "job_completed", { checks, note: note || null });
  await notifyComplete({ name: current.name, phone: current.phone }).catch(() => {});
  await alertOwner(
    [
      "JOB COMPLETED",
      "",
      "Customer:",
      current.name,
      "",
      "Completed by:",
      session.staff.full_name || "crew",
      // A note from the crew is the whole reason to read this text, so it goes
      // above the routine next-step line rather than at the bottom.
      ...(note ? ["", "Note from the crew:", note] : []),
      "",
      "Request payment when you're ready.",
    ].join("\n"),
    session.staff.phone,
  ).catch(() => {});

  // A job the customer already paid in full has been sitting on a paid_at with
  // no status to match it, because money arriving cannot be allowed to skip
  // this close-out. Now that the work is done, it can move.
  await settleJobIfPaid(id).catch(() => {});

  revalidatePath(`/crm/quotes/${id}`);
  revalidatePath("/crm");
  // The crew marks jobs done from their own job page.
  revalidatePath("/job/[token]", "page");
  return { ok: true, message: "Job closed out and the customer has been thanked." };
}

// Payment used to live here: a Zelle-instructions text and a Mark paid button
// that stamped paid_at and nothing else. Both are gone. Money is recorded
// against the ledger now - see payment-actions.ts - so "is this paid" has one
// answer, arrived at by adding up payments rather than by somebody asserting it.

// Regenerate the customer + contractor capability tokens. Use this if a link is
// leaked or shared too widely: the old /q/<token> and /job/<token> URLs stop
// resolving immediately and you re-text the fresh customer link.
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
