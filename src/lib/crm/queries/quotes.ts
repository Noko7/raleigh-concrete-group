// Server-only CRM data access: leads/quotes, the activity log. Re-exported from ../queries.ts.
import { jobPatchRefusal, refusalBasis } from "../permissions";
import { pgUser, pgAdmin } from "../rest";
import type { Quote, QuoteEvent, Session } from "../types";

export type QuoteFilters = { status?: string; assignedTo?: string; search?: string; archived?: boolean };

// Archived (soft-deleted) leads are hidden unless { archived: true }.
export async function listQuotes(session: Session, filters: QuoteFilters = {}): Promise<Quote[]> {
  const params = new URLSearchParams();
  params.set("select", "*");
  params.set("order", "created_at.desc");
  params.set("archived_at", filters.archived ? "not.is.null" : "is.null");
  if (filters.status) params.set("status", `eq.${filters.status}`);
  if (filters.assignedTo === "unassigned") params.set("assigned_to", "is.null");
  else if (filters.assignedTo) params.set("assigned_to", `eq.${filters.assignedTo}`);
  if (filters.search) {
    const s = filters.search.replace(/[%,()*]/g, " ").trim();
    if (s) params.set("or", `(name.ilike.*${s}*,phone.ilike.*${s}*,email.ilike.*${s}*,address.ilike.*${s}*)`);
  }
  const res = await pgUser(`quote_requests?${params.toString()}`, session.accessToken);
  if (!res.ok) return [];
  return (await res.json()) as Quote[];
}

// Booked work days and in-person visits, for the calendar. RLS scopes the rows.
export async function listScheduled(session: Session): Promise<Quote[]> {
  const res = await pgUser(
    "quote_requests?select=*&or=(scheduled_date.not.is.null,visit_date.not.is.null)&order=created_at.desc",
    session.accessToken,
  );
  if (!res.ok) return [];
  return (await res.json()) as Quote[];
}

export async function getQuote(session: Session, id: string): Promise<Quote | null> {
  const res = await pgUser(
    `quote_requests?id=eq.${encodeURIComponent(id)}&select=*&limit=1`,
    session.accessToken,
  );
  if (!res.ok) return null;
  const rows = (await res.json()) as Quote[];
  return rows[0] ?? null;
}

// Like updateQuote, but says why it failed.
export async function updateQuoteResult(
  session: Session,
  id: string,
  patch: Partial<Quote>,
): Promise<{ quote: Quote | null; error?: string }> {
  // Contractors can't see Lost jobs (crew-views.sql), so their own login can't
  // set Lost. The service role writes it, scoped to a job still assigned to them.
  const losing = session.staff.role !== "owner" && patch.status === "lost";
  // That bypasses the DB's money-column guard, so the same rule is checked
  // here: Lost doesn't carry a price or Paid change with it.
  let unchangedSince = "";
  if (losing) {
    const before = await getQuote(session, id);
    if (!before) return { quote: null, error: "You can't change this job. It may have been reassigned to someone else." };
    const refusal = jobPatchRefusal(session.staff.role, before, patch, session.staff.id);
    if (refusal) return { quote: null, error: refusal };
  // Write only if the row still holds what that check read.
    for (const [column, value] of Object.entries(refusalBasis(before, patch))) {
      unchangedSince +=
        value === null
          ? `&${column}=is.null`
          : typeof value === "boolean"
            ? `&${column}=is.${value}`
            : `&${column}=eq.${encodeURIComponent(String(value))}`;
    }
  }
  const path = `quote_requests?id=eq.${encodeURIComponent(id)}`;
  const init = { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(patch) };
  const res = losing
    ? await pgAdmin(
        `${path}&assigned_to=eq.${encodeURIComponent(session.staff.id)}&archived_at=is.null${unchangedSince}`,
        init,
      )
    : await pgUser(path, session.accessToken, init);

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[updateQuote] failed", { id, status: res.status, body, patch: Object.keys(patch) });

    if (res.status === 409) {
      return { quote: null, error: "Another job is already booked on that day." };
    }
    return { quote: null, error: `Could not save (error ${res.status}). Please try again or call the office.` };
  }

  const rows = (await res.json()) as Quote[];
  // A PATCH that matched nothing: RLS hid the row (no longer assigned).
  if (!rows[0]) {
    return {
      quote: null,
      error: losing
        ? "This job changed while you were saving - the customer may have just answered, or it was reassigned. Reload it and try again."
        : "You can't change this job. It may have been reassigned to someone else.",
    };
  }
  return { quote: rows[0] };
}

export async function updateQuote(session: Session, id: string, patch: Partial<Quote>): Promise<Quote | null> {
  return (await updateQuoteResult(session, id, patch)).quote;
}

// A lead staff log themselves (a phone-in). Runs as the user (RLS); tokens come
// from column defaults. Returns why it failed: RLS and a check constraint need
// different fixes.
export async function insertQuoteResult(
  session: Session,
  row: Partial<Quote>,
): Promise<{ quote: Quote | null; error?: string; code?: string }> {
  const res = await pgUser("quote_requests", session.accessToken, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(row),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[insertQuote] failed", { status: res.status, body, columns: Object.keys(row) });
    // PostgREST puts the SQLSTATE in the body.
    const code = body.match(/"code"\s*:\s*"([^"]+)"/)?.[1] ?? "";

    // 42501 = table grant or RLS policy.
    if (code === "42501" || /row-level security|permission denied/i.test(body)) {
      return {
        quote: null,
        code,
        error: "The database is not letting this account create leads.",
      };
    }
    // e.g. 23514 check violation; the caller knows which new field it sent.
    return {
      quote: null,
      code,
      error: `Could not save the lead (error ${res.status}${code ? ` / ${code}` : ""}). Check the values and try again.`,
    };
  }

  const rows = (await res.json().catch(() => [])) as Quote[];
  if (!rows[0]) {
    // Written but not readable back. "Could not save" would get it entered twice.
    return { quote: null, error: "The lead saved but could not be read back. Check the pipeline before adding it again." };
  }
  return { quote: rows[0] };
}

export async function addEvent(
  session: Session,
  quoteId: string,
  type: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  const init = {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ quote_id: quoteId, type, meta: meta ?? null, actor: session.staff.id }),
  };
  const res = await pgUser("quote_events", session.accessToken, init);
  // A contractor who just marked the job Lost can no longer see it, so the
  // history row is written by the server, for a job still assigned to them.
  if (!res.ok && session.staff.role !== "owner" && /^[0-9a-fA-F-]{36}$/.test(quoteId)) {
    const own = await pgAdmin(`quote_requests?id=eq.${quoteId}&assigned_to=eq.${session.staff.id}&select=id&limit=1`);
    if (own.ok && ((await own.json()) as unknown[]).length > 0) await pgAdmin("quote_events", init);
  }
}

export async function listEvents(session: Session, quoteId: string): Promise<QuoteEvent[]> {
  const res = await pgUser(
    `quote_events?quote_id=eq.${encodeURIComponent(quoteId)}&select=*&order=created_at.desc&limit=100`,
    session.accessToken,
  );
  if (!res.ok) return [];
  return (await res.json()) as QuoteEvent[];
}

// Activity-log entry from server-only processes (no session).
export async function addAdminEvent(quoteId: string, type: string, meta?: Record<string, unknown>): Promise<void> {
  await pgAdmin("quote_events", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ quote_id: quoteId, type, meta: meta ?? null, actor: null }),
  });
}

// ── Platform activity (who did what, across every job) ──────────────────────
// RLS: owners see everything, contractors only their assigned jobs' events.
export async function listRecentActivity(session: Session, limit = 250): Promise<QuoteEvent[]> {
  const res = await pgUser(
    `quote_events?select=*&order=created_at.desc&limit=${limit}`,
    session.accessToken,
  );
  if (!res.ok) return [];
  return (await res.json()) as QuoteEvent[];
}

// Job names for an activity feed in one query. Not an embed, so archived jobs
// still resolve.
export async function getQuoteNames(session: Session, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const list = unique.map((id) => encodeURIComponent(id)).join(",");
  const res = await pgUser(`quote_requests?id=in.(${list})&select=id,name`, session.accessToken);
  if (!res.ok) return new Map();
  const rows = (await res.json()) as { id: string; name: string }[];
  return new Map(rows.map((r) => [r.id, r.name]));
}

export type JobHead = Pick<Quote, "id" | "name" | "service" | "address" | "city" | "assigned_to" | "status"> & {
  is_test?: boolean;
  archived_at: string | null;
};

// The few columns the Documents hub lists a job by, archived jobs included: their paperwork is still kept.
// Batched so a long id list stays under URL limits.
export async function getJobHeads(session: Session, ids: string[]): Promise<Map<string, JobHead>> {
  const unique = [...new Set(ids.filter((id) => /^[0-9a-fA-F-]{36}$/.test(id)))];
  const out = new Map<string, JobHead>();
  for (let i = 0; i < unique.length; i += 150) {
    const res = await pgUser(
      `quote_requests?id=in.(${unique.slice(i, i + 150).join(",")})` +
        "&select=id,name,service,address,city,assigned_to,status,is_test,archived_at",
      session.accessToken,
    );
    if (!res.ok) continue;
    for (const r of (await res.json()) as JobHead[]) out.set(r.id, r);
  }
  return out;
}
