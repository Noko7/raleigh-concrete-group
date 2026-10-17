"use server";

import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/crm/auth";
import { alertOwner, notifyComplete } from "@/lib/crm/notify";
import { addEvent, getQuote, updateQuote } from "@/lib/crm/queries";
import { settleJobIfPaid } from "@/lib/crm/payments";
import type { Quote } from "@/lib/crm/types";
import type { FinishState } from "./types";

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
