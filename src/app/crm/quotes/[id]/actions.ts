"use server";

import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/crm/auth";
import { STATUSES, STATUS_LABELS, type Status } from "@/lib/crm/env";
import { syncQuoteToCalendar } from "@/lib/crm/gcal";
import { alertOwner, notifyAssignment, notifyComplete, notifyPaymentRequest, notifyQuoteReady } from "@/lib/crm/notify";
import { addEvent, getQuote, getStaffById, updateQuote } from "@/lib/crm/queries";
import type { Quote } from "@/lib/crm/types";
import type { SaveState } from "./types";

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
      await notifyAssignment(contractor?.phone, {
        name: current.name,
        phone: current.phone,
        service: current.service,
        job_token: current.job_token,
      }).catch(() => {});
      await alertOwner(
        `${current.name} assigned to ${contractor?.full_name || "a contractor"}.`,
        session.staff.phone,
      ).catch(() => {});
      // Invite the newly-assigned contractor on Google Calendar (if dated).
      await syncQuoteToCalendar(id);
    }
    if (patch.status) {
      await alertOwner(
        `${current.name}: moved to ${STATUS_LABELS[patch.status]} by ${session.staff.full_name || "crew"}.`,
        session.staff.phone,
      ).catch(() => {});
    }
    // Marking the job Completed here (via the status dropdown) also thanks the customer.
    if (patch.status === "completed" && current.status !== "completed") {
      await notifyComplete({ name: current.name, phone: current.phone }).catch(() => {});
    }

    let smsDelivered = false;
    if (sending) {
      const r = await notifyQuoteReady({
        name: current.name,
        phone: current.phone,
        public_token: current.public_token,
      }).catch(() => null);
      smsDelivered = Boolean(r?.ok);
      await alertOwner(`Quote sent to ${current.name}.`, session.staff.phone).catch(() => {});
    }

    revalidatePath(`/crm/quotes/${id}`);
    revalidatePath("/crm");
    return { ok: true, sent: sending, smsDelivered: sending ? smsDelivered : undefined };
  } catch (err) {
    console.error("[saveQuote] failed", err);
    return { ok: false, error: "Something went wrong saving this quote. Please try again." };
  }
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

  const updated = await updateQuote(session, id, { status: "completed", completed_at: new Date().toISOString() });
  if (!updated) return;

  await addEvent(session, id, "status_changed", { from: current.status, to: "completed" });
  await addEvent(session, id, "job_completed");
  await notifyComplete({ name: current.name, phone: current.phone }).catch(() => {});
  await alertOwner(
    `Job completed: ${current.name}, by ${session.staff.full_name || "crew"}.`,
    session.staff.phone,
  ).catch(() => {});

  revalidatePath(`/crm/quotes/${id}`);
  revalidatePath("/crm");
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
  await alertOwner(
    `Payment requested from ${current.name} by ${session.staff.full_name || "crew"}.`,
    session.staff.phone,
  ).catch(() => {});

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
    `Paid: ${current.name}${current.quote_amount != null ? ` ($${Number(current.quote_amount).toLocaleString("en-US")})` : ""}, recorded by ${session.staff.full_name || "crew"}.`,
    session.staff.phone,
  ).catch(() => {});

  revalidatePath(`/crm/quotes/${id}`);
  revalidatePath("/crm");
}
