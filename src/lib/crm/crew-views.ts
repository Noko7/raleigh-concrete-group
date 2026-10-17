// How often each contractor opens each job page. Owner-only to read (RLS on
// job_staff_views); written only by the server through bump_job_staff_view, so
// nobody can change their own count. See supabase/crew-views.sql.
import { pgAdmin, pgUser } from "./rest";
import type { Session } from "./types";

const UUID_RE = /^[0-9a-fA-F-]{36}$/;

export type CrewView = { quote_id: string; staff_id: string; view_count: number; last_viewed_at: string };

export async function bumpCrewView(quoteId: string, staffId: string): Promise<void> {
  if (!UUID_RE.test(quoteId) || !UUID_RE.test(staffId)) return;
  await pgAdmin("rpc/bump_job_staff_view", {
    method: "POST",
    body: JSON.stringify({ p_quote: quoteId, p_staff: staffId }),
  }).catch(() => {});
}

/** Every count the reader may see - all of them for an owner, none for anybody else. */
export async function listCrewViews(session: Session, quoteId?: string): Promise<CrewView[]> {
  if (session.staff.role !== "owner") return [];
  if (quoteId && !UUID_RE.test(quoteId)) return [];
  const res = await pgUser(
    `job_staff_views?select=quote_id,staff_id,view_count,last_viewed_at${quoteId ? `&quote_id=eq.${quoteId}` : ""}` +
      "&order=last_viewed_at.desc&limit=5000",
    session.accessToken,
  ).catch(() => null);
  if (!res?.ok) return [];
  return (await res.json()) as CrewView[];
}
