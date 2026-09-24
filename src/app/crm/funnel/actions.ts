"use server";

import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/crm/auth";
import { pgAdmin } from "@/lib/crm/rest";
import { UUID_RE } from "@/lib/quote-submit";

/**
 * Take a started-but-not-sent quote off the Funnel page's call list: called
 * them, they went elsewhere, it was a test. The row stays (it ages out with the
 * rest of quote_drafts); it just stops asking to be called.
 */
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
