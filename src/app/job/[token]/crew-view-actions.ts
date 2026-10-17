"use server";

import { getSession } from "@/lib/crm/auth";
import { bumpCrewView } from "@/lib/crm/crew-views";
import { getQuoteByToken } from "@/lib/crm/queries";

/** Count one contractor opening their job page. Owners aren't counted. */
export async function recordCrewView(token: string): Promise<void> {
  const session = await getSession();
  if (!session || session.staff.role === "owner") return;
  const quote = await getQuoteByToken("job_token", token);
  if (!quote || quote.assigned_to !== session.staff.id) return;
  await bumpCrewView(quote.id, session.staff.id);
}
