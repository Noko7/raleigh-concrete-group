"use server";

import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/crm/auth";
import {
  QUOTE_SECTION_FIELDS,
  QUOTE_SECTION_LABELS,
  QUOTE_TTL_DAYS,
  TIME_RE,
  noEmDash,
} from "@/lib/crm/constants";
import { STATUSES, type Status } from "@/lib/crm/env";
import { syncQuoteToCalendar } from "@/lib/crm/gcal";
import {
  alertOwner,
  notifyAssignment,
  notifyBooked,
  notifyComplete,
  notifyCustomerRescheduled,
  notifyCustomerScheduled,
  notifyPaymentRequest,
  notifyQuoteReady,
  notifyQuoteSent,
  notifyVisitConfirmed,
  type SendResult,
} from "@/lib/crm/notify";
import {
  MAX_VISITS_PER_DAY,
  addEvent,
  confirmSchedule,
  conflictMessage,
  countVisitsOn,
  findVisitConflict,
  getQuote,
  getStaffById,
  lastMessageOf,
  updateQuote,
  updateQuoteResult,
} from "@/lib/crm/queries";
import type { Quote } from "@/lib/crm/types";
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
      patch.assigned_to = next;
      events.push({ type: "assigned", meta: { to: next } });
    }
  }

  // Quote amount
  if (formData.has("quote_amount")) {
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
    if (patch.quote_summary !== current.quote_summary) events.push({ type: "summary_changed" });
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
  if (sectionsChanged) events.push({ type: "summary_changed" });

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
  const effectiveAmount = patch.quote_amount !== undefined ? patch.quote_amount : current.quote_amount;
  const effectiveSummary = patch.quote_summary !== undefined ? patch.quote_summary : current.quote_summary;

  if (sending) {
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

    // One quote text, then wait for an answer.
    //
    // Nothing visible happens on this page when a text goes out, so the natural
    // response to uncertainty is to press Send again. Ten identical texts is how
    // that looks from the customer's phone, and not one of them carries any
    // information the first didn't. The customer reads it as disorganised at the
    // exact moment they're deciding whether to hand over thousands of dollars.
    //
    // Three things mean the block would be wrong, so each lifts it:
    //   - they've replied, so this is a revised quote rather than a repeat
    //   - the last text never left the building, so nothing was delivered
    //   - an owner deliberately asked to send it again
    if (current.quote_sent_at && !current.customer_response) {
      const last = await lastMessageOf(session, id, "quote_ready");
      // No log row (or the table isn't there yet) is treated as delivered: the
      // safe default when we can't tell is not to text them twice.
      const reached = last ? last.ok : true;
      if (reached && !(intent === "resend" && isOwner)) {
        return {
          ok: false,
          error: `${current.name.trim().split(/\s+/)[0] || "The customer"} was already texted this quote and hasn't replied yet, so it won't send twice. If they say it never arrived, the owner can send it again.`,
          alreadySent: true,
        };
      }
    }
    if (current.status !== "quoted" && patch.status !== "quoted") {
      patch.status = "quoted";
      events.push({ type: "status_changed", meta: { from: current.status, to: "quoted" } });
    }
    if (!current.quote_sent_at) patch.quote_sent_at = new Date().toISOString();
    // The link is good for seven days from THIS send. Re-stamped on every
    // send, not just the first, so re-sending is what revives an expired
    // quote - which is the whole recovery path for one that ran out.
    patch.quote_expires_at = new Date(Date.now() + QUOTE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    events.push({ type: "quote_sent" });
  }

  if (!sending && Object.keys(patch).length === 0) return { ok: true };

  try {
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
    let smsTo: string | undefined;
    if (sending) {
      // Deliberately not swallowed: the whole point of this button is that the
      // customer receives something, so a failure has to reach the screen with
      // the provider's own reason rather than a silent false.
      const r = await notifyQuoteReady({
        id,
        name: current.name,
        phone: current.phone,
        public_token: current.public_token,
      }).catch((e) => ({ ok: false, provider: "unknown", detail: String(e) }) as SendResult);

      smsDelivered = r.ok;
      smsTo = r.to ?? current.phone;
      if (!r.ok) {
        smsError = [r.detail, r.status ? `(HTTP ${r.status})` : ""].filter(Boolean).join(" ").slice(0, 500);
      }
      // The quote is recorded as sent either way - it genuinely was marked sent
      // and the link is live - but the log keeps whether it actually reached
      // them, so a silent texting outage is visible afterwards.
      await addEvent(session, id, "quote_delivery", {
        delivered: r.ok,
        to: smsTo,
        error: smsError ?? null,
      }).catch(() => {});

      // Tell the office it's out and the sender that it landed. Deliberately
      // after the delivery result, so neither message claims a send that failed.
      await notifyQuoteSent(
        {
          id,
          name: current.name,
          phone: current.phone,
          quote_amount: effectiveAmount,
          job_token: current.job_token,
        },
        { name: session.staff.full_name, phone: session.staff.phone, isOwner },
        r.ok,
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
      smsDelivered: sending ? smsDelivered : undefined,
      smsError: sending ? smsError : undefined,
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
  await notifyBooked(info, contractor?.phone, result.previous, result.previousTime).catch(() => {});
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

  // Re-confirming the day this job is already on shouldn't report it as full on
  // account of itself.
  const alreadyOnThisDay = current.quote_type === "inperson" && current.visit_date === date;
  if (!alreadyOnThisDay && (await countVisitsOn(date)) >= MAX_VISITS_PER_DAY) {
    return { ok: false, error: "That day is already full for quote visits. Pick another." };
  }

  // Whoever this job belongs to has to actually be free. Confirming here is the
  // moment an offered slot becomes somewhere a person has to be, so it's the
  // moment to find out they're already booked - not on the morning.
  const clash = await findVisitConflict(current.assigned_to, date, time, id);
  if (clash) return { ok: false, error: conflictMessage(clash) };

  const wasOnline = current.quote_type === "online";
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

  const movedOff = current.visit_date !== date || (current.visit_time ?? "") !== time;
  await addEvent(session, id, "visit_confirmed", {
    to: date,
    to_time: time,
    requested: current.visit_date ?? null,
    requested_time: current.visit_time ?? null,
    moved: movedOff,
  });

  // Whoever the job belongs to gets the text, not whoever happened to click. On
  // the crew's own job page these are the same person; from the CRM they aren't.
  const crew = current.assigned_to ? await getStaffById(session, current.assigned_to) : null;
  await notifyVisitConfirmed(
    {
      id,
      name: current.name,
      phone: current.phone,
      service: current.service,
      address: current.address,
      quote_type: "inperson",
      visit_date: date,
      visit_time: time,
      job_token: current.job_token,
    },
    crew?.phone ?? session.staff.phone,
    crew?.full_name ?? session.staff.full_name,
    // What they originally asked for, so the customer text can own up to it if
    // the crew put them on a different day.
    { date: current.visit_date, time: current.visit_time },
    // Read before the update above flipped it. An in-person request being given
    // a date is not the same story as an online one being converted.
    wasOnline,
  ).catch(() => {});
  await syncQuoteToCalendar(id);

  revalidatePath(`/crm/quotes/${id}`);
  revalidatePath("/crm");
  revalidatePath("/crm/calendar");
  revalidatePath("/job/[token]", "page");
  return {
    ok: true,
    message: movedOff
      ? "Visit confirmed for the new day. The customer and the crew have been texted."
      : "Visit confirmed. The customer and the crew have been texted.",
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

  revalidatePath(`/crm/quotes/${id}`);
  revalidatePath("/crm");
  // The crew marks jobs done from their own job page.
  revalidatePath("/job/[token]", "page");
  return { ok: true, message: "Job closed out and the customer has been thanked." };
}

// Text the customer how to pay (Zelle / bank deposit). The actual instructions
// live in the PAYMENT_INSTRUCTIONS env var so you can change your Zelle handle
// without a code change.
export async function requestPayment(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const current = await getQuote(session, id);
  if (!current) return;

  const sent = await notifyPaymentRequest({
    id,
    name: current.name,
    phone: current.phone,
    quote_amount: current.quote_amount,
    // Carries the link to their approved total, since the text itself never
    // states a figure.
    public_token: current.public_token,
  }).catch(() => null);

  await updateQuote(session, id, { payment_requested_at: new Date().toISOString() });
  await addEvent(session, id, "payment_requested", { delivered: Boolean(sent?.ok) });

  revalidatePath(`/crm/quotes/${id}`);
  revalidatePath("/crm");
}

// Money's in. Move it to Paid - the end of the pipeline.
export async function markPaid(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const current = await getQuote(session, id);
  if (!current || current.status === "paid") return;

  const updated = await updateQuote(session, id, {
    status: "paid",
    paid_at: new Date().toISOString(),
    completed_at: current.completed_at ?? new Date().toISOString(),
  });
  if (!updated) return;

  await addEvent(session, id, "status_changed", { from: current.status, to: "paid" });
  await addEvent(session, id, "job_paid", { amount: current.quote_amount });
  await alertOwner(
    [
      "PAID",
      "",
      "Customer:",
      current.name,
      ...(current.quote_amount != null
        ? ["", "Amount:", `$${Number(current.quote_amount).toLocaleString("en-US")}`]
        : []),
      "",
      "Recorded by:",
      session.staff.full_name || "crew",
    ].join("\n"),
    session.staff.phone,
  ).catch(() => {});

  revalidatePath(`/crm/quotes/${id}`);
  revalidatePath("/crm");
}

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
