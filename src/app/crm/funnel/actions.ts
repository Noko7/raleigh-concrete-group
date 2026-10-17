"use server";

import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/crm/auth";
import { pgAdmin } from "@/lib/crm/rest";
import { UUID_RE } from "@/lib/quote-submit";

/** Removes it from the call list (called, went elsewhere, test). The row stays and ages out with quote_drafts. */
export async function dismissDraft(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session || session.staff.role !== "owner") return;
  const id = String(formData.get("submission_id") ?? "").trim().toLowerCase();
  if (!UUID_RE.test(id)) return;
  const res = await pgAdmin(`quote_drafts?submission_id=eq.${id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ dismissed_at: new Date().toISOString() }),
  });
  if (!res.ok) console.error("[funnel] dismiss draft failed", res.status);
  revalidatePath("/crm/funnel");
}
