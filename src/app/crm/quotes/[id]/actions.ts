"use server";

import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/crm/auth";
import { STATUSES, STATUS_LABELS, type Status } from "@/lib/crm/env";
import { alertAssigned, alertOwner } from "@/lib/crm/notify";
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
  const patch: Partial<Quote> = {};
  const events: { type: string; meta?: Record<string, unknown> }[] = [];

  // Status
  const status = String(formData.get("status") ?? "");
  if (status && STATUSES.includes(status as Status) && status !== current.status) {
    patch.status = status as Status;
    if (status === "sent" && !current.quote_sent_at) patch.quote_sent_at = new Date().toISOString();
    events.push({ type: "status_changed", meta: { from: current.status, to: status } });
  }

  // Assignment (owner only)
  if (isOwner && formData.has("assigned_to")) {
    const raw = String(formData.get("assigned_to") ?? "").trim();
    const next = raw === "" ? null : raw;
    if (next !== current.assigned_to) {
      patch.assigned_to = next;
      if (next && current.status === "new" && !patch.status) patch.status = "assigned";
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
  }

  // Customer-facing summary
  if (formData.has("quote_summary")) {
    const v = String(formData.get("quote_summary") ?? "").trim().slice(0, 4000);
    patch.quote_summary = v || null;
  }

  // Internal notes
  if (formData.has("internal_notes")) {
    const v = String(formData.get("internal_notes") ?? "").trim().slice(0, 4000);
    patch.internal_notes = v || null;
  }

  if (Object.keys(patch).length === 0) return { ok: true };

  const updated = await updateQuote(session, id, patch);
  if (!updated) return { ok: false, error: "Could not save. Check your access and try again." };

  for (const e of events) await addEvent(session, id, e.type, e.meta);

  // Texts: alert a newly-assigned contractor, and owners on every change (the
  // acting user is excluded so they aren't texted about their own edits).
  if (patch.assigned_to) {
    const contractor = await getStaffById(session, patch.assigned_to);
    await alertAssigned(contractor?.phone, {
      name: current.name,
      phone: current.phone,
      service: current.service,
      job_token: current.job_token,
    }).catch(() => {});
    await alertOwner(
      `${current.name} assigned to ${contractor?.full_name || "a contractor"}.`,
      session.staff.phone,
    ).catch(() => {});
  }
  if (patch.status) {
    await alertOwner(
      `${current.name}: moved to ${STATUS_LABELS[patch.status]} by ${session.staff.full_name || "crew"}.`,
      session.staff.phone,
    ).catch(() => {});
  }

  revalidatePath(`/crm/quotes/${id}`);
  revalidatePath("/crm");
  return { ok: true };
}
