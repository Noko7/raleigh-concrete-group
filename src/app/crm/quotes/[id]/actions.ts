"use server";

import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/crm/auth";
import { VISIT_TIME_SLOTS } from "@/lib/crm/constants";
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
  notifyVisitConfirmed,
  type SendResult,
} from "@/lib/crm/notify";
import {
  MAX_VISITS_PER_DAY,
  addEvent,
  confirmSchedule,
  countVisitsOn,
  getQuote,
  getStaffById,
  updateQuote,
  updateQuoteResult,
} from "@/lib/crm/queries";
import type { Quote } from "@/lib/crm/types";
import type { SaveState, ScheduleState } from "./types";

export async function saveQuote(_prev: SaveState, formData: FormData): Promise<SaveState> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Your session expired. Please sign in again." };

  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing quote id." };

  const current = await getQuote(session, id);
  if (!current) return { ok: false, error: "You don't have access to this quote." };

  const isOwner = session.staff.role === "owner";
  const sending = String(formData.get("intent") ?? "") === "send";
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

  // Customer-facing summary
  if (formData.has("quote_summary")) {
    const v = String(formData.get("quote_summary") ?? "").trim().slice(0, 4000);
    patch.quote_summary = v || null;
    if (patch.quote_summary !== current.quote_summary) events.push({ type: "summary_changed" });
  }

  // Internal notes
  if (formData.has("internal_notes")) {
    const v = String(formData.get("internal_notes") ?? "").trim().slice(0, 4000);
    patch.internal_notes = v || null;
    if (patch.internal_notes !== current.internal_notes) events.push({ type: "notes_changed" });
  }

  // "Send Quote": make the customer link live and text it to them. Price and a
  // customer-facing description are both required.
  if (sending) {
    const effectiveAmount = patch.quote_amount !== undefined ? patch.quote_amount : current.quote_amount;
    const effectiveSummary = patch.quote_summary !== undefined ? patch.quote_summary : current.quote_summary;
    if (effectiveAmount == null) return { ok: false, error: "Set a quote amount before sending." };
    if (!effectiveSummary || !effectiveSummary.trim()) {
      return { ok: false, error: "Add a customer-facing description before sending." };
    }
    if (current.status !== "quoted" && patch.status !== "quoted") {
      patch.status = "quoted";
      events.push({ type: "status_changed", meta: { from: current.status, to: "quoted" } });
    }
    if (!current.quote_sent_at) patch.quote_sent_at = new Date().toISOString();
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
      await notifyComplete({ name: current.name, phone: current.phone }).catch(() => {});
    }

    let smsDelivered = false;
    let smsError: string | undefined;
    let smsTo: string | undefined;
    if (sending) {
      // Deliberately not swallowed: the whole point of this button is that the
      // customer receives something, so a failure has to reach the screen with
      // the provider's own reason rather than a silent false.
      const r = await notifyQuoteReady({
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
  const time = String(formData.get("time") ?? "").slice(0, 20);
  if (!id) return { ok: false, error: "Missing job id." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "Pick a date for the visit." };
  // Same slot list the public form offers, so a confirmed visit can never land
  // on a time the business doesn't actually work.
  if (!VISIT_TIME_SLOTS.includes(time)) return { ok: false, error: "Pick a time for the visit." };

  const current = await getQuote(session, id);
  if (!current) return { ok: false, error: "You don't have access to this job." };

  // Re-confirming the day this job is already on shouldn't report it as full on
  // account of itself.
  const alreadyOnThisDay = current.quote_type === "inperson" && current.visit_date === date;
  if (!alreadyOnThisDay && (await countVisitsOn(date)) >= MAX_VISITS_PER_DAY) {
    return { ok: false, error: "That day is already full for quote visits. Pick another." };
  }

  const { quote: updated, error } = await updateQuoteResult(session, id, {
    quote_type: "inperson",
    visit_date: date,
    visit_time: time,
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
export async function completeJob(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const current = await getQuote(session, id);
  if (!current || current.status === "completed" || current.status === "paid") return;

  // The crew's close-out checklist and any note they left. Optional: the owner's
  // own Mark completed button on the CRM page sends neither, and shouldn't have
  // to. What matters is that when they ARE sent, they're recorded and they reach
  // whoever has to act on them.
  const checks = formData.getAll("check").map((c) => String(c)).slice(0, 8);
  const note = String(formData.get("note") ?? "").trim().slice(0, 1000);

  const updated = await updateQuote(session, id, { status: "completed", completed_at: new Date().toISOString() });
  if (!updated) return;

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
    name: current.name,
    phone: current.phone,
    quote_amount: current.quote_amount,
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
