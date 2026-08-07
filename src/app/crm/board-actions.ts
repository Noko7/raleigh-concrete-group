"use server";

import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/crm/auth";
import { STATUSES, STATUS_LABELS, type Status } from "@/lib/crm/constants";
import { syncQuoteToCalendar } from "@/lib/crm/gcal";
import { alertOwner, notifyAssignment, notifyComplete } from "@/lib/crm/notify";
import { addEvent, getQuote, getStaffById, updateQuote } from "@/lib/crm/queries";
import type { Quote } from "@/lib/crm/types";

export type MoveResult = { ok: boolean; error?: string };

// Move a quote to a new pipeline status (used by the Kanban board, drag-drop and
// the per-card move control). RLS still gates whether this user may touch the row.
export async function moveQuote(id: string, status: string): Promise<MoveResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Session expired. Please sign in again." };
  if (!STATUSES.includes(status as Status)) return { ok: false, error: "Unknown status." };

  const current = await getQuote(session, id);
  if (!current) return { ok: false, error: "You don't have access to this quote." };
  if (current.status === status) return { ok: true };

  const patch: Partial<Quote> = { status: status as Status };
  if (status === "quoted" && !current.quote_sent_at) patch.quote_sent_at = new Date().toISOString();
  if (status === "completed" && !current.completed_at) patch.completed_at = new Date().toISOString();
  if (status === "paid" && !current.paid_at) patch.paid_at = new Date().toISOString();

  const updated = await updateQuote(session, id, patch);
  if (!updated) return { ok: false, error: "Could not move this quote." };

  await addEvent(session, id, "status_changed", { from: current.status, to: status });

  // Marking a job Completed thanks the customer and asks for a review.
  if (status === "completed" && current.status !== "completed") {
    await notifyComplete({ name: current.name, phone: current.phone }).catch(() => {});
  }

  // Owners get every status change; the actor is excluded so they aren't texted
  // about their own click.
  await alertOwner(
    `${current.name}: moved to ${STATUS_LABELS[status as Status]} by ${session.staff.full_name || "crew"}.`,
    session.staff.phone,
  ).catch(() => {});
  revalidatePath("/crm");
  return { ok: true };
}

// Owner-only quick assignment from a board card.
export async function assignQuote(id: string, contractorId: string): Promise<MoveResult> {
  const session = await getSession();
  if (!session || session.staff.role !== "owner") return { ok: false, error: "Owners only." };

  const current = await getQuote(session, id);
  if (!current) return { ok: false, error: "Quote not found." };

  const next = contractorId === "" ? null : contractorId;
  const patch: Partial<Quote> = { assigned_to: next };

  const updated = await updateQuote(session, id, patch);
  if (!updated) return { ok: false, error: "Could not assign." };

  await addEvent(session, id, "assigned", { to: next });
  if (next) {
    const contractor = await getStaffById(session, next);
    await notifyAssignment(
      contractor?.phone,
      {
        name: current.name,
        phone: current.phone,
        service: current.service,
        address: current.address,
        scheduled_date: current.scheduled_date,
        visit_date: current.visit_date,
        visit_time: current.visit_time,
        job_token: current.job_token,
      },
      contractor?.full_name,
    ).catch(() => {});
    await alertOwner(
      `${current.name} assigned to ${contractor?.full_name || "a contractor"}.`,
      session.staff.phone,
    ).catch(() => {});
    // If this job/visit has a date, invite the new contractor on Google Calendar.
    await syncQuoteToCalendar(id);
  }
  revalidatePath("/crm");
  return { ok: true };
}

// Owner-only "delete" from the pipeline. This never removes the row or any of
// its quote_events - it just stamps archived_at, which listQuotes filters out
// by default. The lead can always be brought back from /crm/archived.
export async function deleteQuote(id: string): Promise<MoveResult> {
  const session = await getSession();
  if (!session || session.staff.role !== "owner") return { ok: false, error: "Owners only." };

  const current = await getQuote(session, id);
  if (!current) return { ok: false, error: "Quote not found." };
  if (current.archived_at) return { ok: true };

  const updated = await updateQuote(session, id, { archived_at: new Date().toISOString() });
  if (!updated) return { ok: false, error: "Could not delete this lead." };

  await addEvent(session, id, "archived", { by: session.staff.full_name || session.staff.email });
  revalidatePath("/crm");
  revalidatePath("/crm/archived");
  return { ok: true };
}

// Undo a delete: clears archived_at so the lead reappears in the pipeline.
export async function restoreQuote(id: string): Promise<MoveResult> {
  const session = await getSession();
  if (!session || session.staff.role !== "owner") return { ok: false, error: "Owners only." };

  const current = await getQuote(session, id);
  if (!current) return { ok: false, error: "Quote not found." };
  if (!current.archived_at) return { ok: true };

  const updated = await updateQuote(session, id, { archived_at: null });
  if (!updated) return { ok: false, error: "Could not restore this lead." };

  await addEvent(session, id, "restored", { by: session.staff.full_name || session.staff.email });
  revalidatePath("/crm");
  revalidatePath("/crm/archived");
  return { ok: true };
}

// Plain <form action={...}> wrapper for the Archived page (server-rendered, no
// client JS needed there).
export async function restoreQuoteForm(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (id) await restoreQuote(id);
}
