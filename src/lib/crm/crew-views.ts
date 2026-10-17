// Per-contractor job page opens. Owner-only to read (RLS); written only by the server through
// bump_job_staff_view so nobody can change their own count.
import { pgAdmin, pgUser } from "./rest";
import type { Session } from "./types";

const UUID_RE = /^[0-9a-fA-F-]{36}$/;

export type CrewView = {
  quote_id: string;
  staff_id: string;
  view_count: number;
  last_viewed_at: string;
  /** Opens after the job was Lost or archived (locked out). */
  closed_view_count: number;
  last_closed_view_at: string | null;
};

/** `closed`: the job was Lost or archived, so this was a locked-out attempt. */
export async function bumpCrewView(quoteId: string, staffId: string, closed = false): Promise<void> {
  if (!UUID_RE.test(quoteId) || !UUID_RE.test(staffId)) return;
  await pgAdmin("rpc/bump_job_staff_view", {
    method: "POST",
    body: JSON.stringify({ p_quote: quoteId, p_staff: staffId, p_closed: closed }),
  }).catch(() => {});
}

/** All for an owner, none for anyone else. */
export async function listCrewViews(session: Session, quoteId?: string): Promise<CrewView[]> {
  if (session.staff.role !== "owner") return [];
  if (quoteId && !UUID_RE.test(quoteId)) return [];
  const res = await pgUser(
    `job_staff_views?select=quote_id,staff_id,view_count,last_viewed_at,closed_view_count,last_closed_view_at${quoteId ? `&quote_id=eq.${quoteId}` : ""}` +
      "&order=last_viewed_at.desc&limit=5000",
    session.accessToken,
  ).catch(() => null);
  if (!res?.ok) return [];
  return (await res.json()) as CrewView[];
}
