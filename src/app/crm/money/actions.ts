"use server";

import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/crm/auth";
import { cleanAmount } from "@/lib/crm/constants";
import { isRecordedMethod, usd } from "@/lib/crm/fees";
import { recordSettlement } from "@/lib/crm/payments";
import { getQuote, getStaffById } from "@/lib/crm/queries";

export type SettleState = { ok: boolean; error?: string; message?: string };

/**
 * Record a contractor paying the office what they owe (by Zelle/Venmo; nothing
 * goes through Stripe). Owner only: contractors record the cash that creates
 * the fee, so letting them also clear it would let the debtor zero their own
 * balance.
 */
export async function recordFeeSettlement(_prev: SettleState, formData: FormData): Promise<SettleState> {
  const session = await getSession();
  if (!session || session.staff.role !== "owner") return { ok: false, error: "Owners only." };

  const staffId = String(formData.get("staff_id") ?? "").trim();
  if (!staffId) return { ok: false, error: "Pick who paid you." };

  const target = await getStaffById(session, staffId);
  if (!target) return { ok: false, error: "That contractor no longer exists." };

  const cleaned = cleanAmount(formData.get("amount"));
  const dollars = Number(cleaned);
  if (!cleaned || !Number.isFinite(dollars) || dollars <= 0) {
    return { ok: false, error: "Enter how much they sent." };
  }
  const amountCents = Math.round(dollars * 100);

  const method = String(formData.get("method") ?? "");
  if (!isRecordedMethod(method)) return { ok: false, error: "Pick how they sent it." };

  // Optional job; must be one of this contractor's.
  const quoteId = String(formData.get("quote_id") ?? "").trim() || null;
  let jobName: string | null = null;
  if (quoteId) {
    const job = await getQuote(session, quoteId);
    if (!job || job.assigned_to !== staffId) return { ok: false, error: "That job isn't one of theirs." };
    jobName = job.name;
  }

  const saved = await recordSettlement(session, {
    staffId,
    quoteId,
    amountCents,
    method,
    note: String(formData.get("note") ?? "").trim().slice(0, 500) || null,
  });
  if (!saved.ok) {
    return { ok: false, error: "Could not record that. If this keeps happening, run supabase/payments.sql." };
  }

  revalidatePath("/crm/money");
  if (quoteId) {
    revalidatePath(`/crm/quotes/${quoteId}`);
    revalidatePath("/job/[token]", "page");
  }
  return {
    ok: true,
    message: `${usd(amountCents)} from ${target.full_name || "them"} recorded${jobName ? ` for ${jobName}` : ""}.`,
  };
}
