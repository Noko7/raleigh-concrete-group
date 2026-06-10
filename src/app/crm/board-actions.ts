"use server";

import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/crm/auth";
import { STATUSES, type Status } from "@/lib/crm/constants";
import { addEvent, getQuote, updateQuote } from "@/lib/crm/queries";
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
  if (status === "sent" && !current.quote_sent_at) patch.quote_sent_at = new Date().toISOString();

  const updated = await updateQuote(session, id, patch);
  if (!updated) return { ok: false, error: "Could not move this quote." };

  await addEvent(session, id, "status_changed", { from: current.status, to: status });
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
  if (next && current.status === "new") patch.status = "assigned";

  const updated = await updateQuote(session, id, patch);
  if (!updated) return { ok: false, error: "Could not assign." };

  await addEvent(session, id, "assigned", { to: next });
  revalidatePath("/crm");
  return { ok: true };
}
