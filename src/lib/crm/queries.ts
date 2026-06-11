// Server-only data access for the CRM. Reads/writes that belong to a logged-in
// user go through pgUser (RLS enforces owner/contractor scoping). Token-page
// lookups, view tracking and signed URLs use pgAdmin (no user context).
import { DECLINE_CREDIT } from "./constants";
import { SUPABASE_URL, SERVICE_KEY, UPLOAD_BUCKET } from "./env";
import { pgUser, pgAdmin } from "./rest";
import type { Quote, QuoteEvent, Session, Staff } from "./types";

export type QuoteFilters = { status?: string; assignedTo?: string; search?: string };

export async function listQuotes(session: Session, filters: QuoteFilters = {}): Promise<Quote[]> {
  const params = new URLSearchParams();
  params.set("select", "*");
  params.set("order", "created_at.desc");
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

// Everything with a date on it - booked work days (scheduled_date) and in-person
// quote visits (visit_date) - for the CRM calendar. RLS scopes this to the
// owner (all rows) or a contractor (only their assigned jobs).
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

export async function updateQuote(session: Session, id: string, patch: Partial<Quote>): Promise<Quote | null> {
  const res = await pgUser(`quote_requests?id=eq.${encodeURIComponent(id)}`, session.accessToken, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) return null;
  const rows = (await res.json()) as Quote[];
  return rows[0] ?? null;
}

// id → display name for showing assignees without a PostgREST join.
export function staffNameMap(staff: Staff[]): Map<string, string> {
  return new Map(staff.map((s) => [s.id, s.full_name || s.email || "Staff"]));
}

export async function addEvent(
  session: Session,
  quoteId: string,
  type: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  await pgUser("quote_events", session.accessToken, {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ quote_id: quoteId, type, meta: meta ?? null, actor: session.staff.id }),
  });
}

export async function listEvents(session: Session, quoteId: string): Promise<QuoteEvent[]> {
  const res = await pgUser(
    `quote_events?quote_id=eq.${encodeURIComponent(quoteId)}&select=*&order=created_at.desc&limit=100`,
    session.accessToken,
  );
  if (!res.ok) return [];
  return (await res.json()) as QuoteEvent[];
}

export async function listStaff(session: Session): Promise<Staff[]> {
  const res = await pgUser("staff?select=*&order=created_at.asc", session.accessToken);
  if (!res.ok) return [];
  return (await res.json()) as Staff[];
}

export async function listContractors(session: Session): Promise<Staff[]> {
  const all = await listStaff(session);
  return all.filter((s) => s.role === "contractor");
}

export async function getStaffById(session: Session, id: string): Promise<Staff | null> {
  const res = await pgUser(`staff?id=eq.${encodeURIComponent(id)}&select=*&limit=1`, session.accessToken);
  if (!res.ok) return null;
  const rows = (await res.json()) as Staff[];
  return rows[0] ?? null;
}

// Self-service profile update. Uses the service role so a contractor can edit
// their own row, but the server restricts the write to their own id and to the
// name/phone columns only - role and active can never be changed here.
export async function updateOwnProfile(
  session: Session,
  patch: { full_name?: string | null; phone?: string | null },
): Promise<boolean> {
  const body: Record<string, unknown> = {};
  if (patch.full_name !== undefined) body.full_name = patch.full_name;
  if (patch.phone !== undefined) body.phone = patch.phone;
  if (Object.keys(body).length === 0) return true;
  const res = await pgAdmin(`staff?id=eq.${encodeURIComponent(session.staff.id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  return res.ok;
}

// Phones of every active owner - they receive all notifications. Service role so
// this works from /api/quote (no user session) too.
export async function getOwnerPhones(): Promise<string[]> {
  const res = await pgAdmin("staff?role=eq.owner&active=eq.true&select=phone");
  if (!res.ok) return [];
  const rows = (await res.json()) as { phone: string | null }[];
  return rows.map((r) => r.phone).filter((p): p is string => typeof p === "string" && p.trim() !== "");
}

// ── Booking capacity ────────────────────────────────────────────────────────
// One booked job per day; up to five in-person quote visits per day.
export const MAX_JOBS_PER_DAY = 1;
export const MAX_VISITS_PER_DAY = 5;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// How many work jobs are already booked on a date (accepted quotes). Optionally
// ignore one quote id (so re-accepting the same quote doesn't count against it).
export async function countJobsOn(date: string, excludeId?: string): Promise<number> {
  if (!ISO_DATE.test(date)) return 0;
  let path = `quote_requests?scheduled_date=eq.${date}&customer_response=eq.accepted&select=id`;
  if (excludeId && /^[0-9a-fA-F-]{36}$/.test(excludeId)) path += `&id=neq.${excludeId}`;
  const res = await pgAdmin(path);
  if (!res.ok) return 0;
  return ((await res.json()) as unknown[]).length;
}

// How many in-person quote visits are already scheduled on a date.
export async function countVisitsOn(date: string): Promise<number> {
  if (!ISO_DATE.test(date)) return 0;
  const res = await pgAdmin(`quote_requests?visit_date=eq.${date}&select=id`);
  if (!res.ok) return 0;
  return ((await res.json()) as unknown[]).length;
}

// Service-role phone lookup for one staff member (used by token-gated server code
// that has no session, e.g. notifying an assigned contractor on customer accept).
export async function getStaffPhoneById(id: string): Promise<string | null> {
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) return null;
  const res = await pgAdmin(`staff?id=eq.${id}&select=phone&limit=1`);
  if (!res.ok) return null;
  const rows = (await res.json()) as { phone: string | null }[];
  return rows[0]?.phone ?? null;
}

// ── Owner settings (app_integrations, provider='settings') ──────────────────
// Currently just the primary contractor every new quote auto-assigns to.
export async function getPrimaryContractorId(): Promise<string | null> {
  const res = await pgAdmin("app_integrations?provider=eq.settings&select=data&limit=1");
  if (!res.ok) return null;
  const rows = (await res.json()) as { data: { primary_contractor_id?: string } }[];
  return rows[0]?.data?.primary_contractor_id || null;
}

export async function setPrimaryContractorId(id: string | null): Promise<boolean> {
  const res = await pgAdmin("app_integrations", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      provider: "settings",
      data: { primary_contractor_id: id },
      updated_at: new Date().toISOString(),
    }),
  });
  return res.ok;
}

// Service-role lookup of a contractor's contact info (no session) - used by the
// public submission endpoint when auto-assigning the primary contractor.
export async function getStaffContactById(id: string): Promise<{ phone: string | null; email: string | null } | null> {
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) return null;
  const res = await pgAdmin(`staff?id=eq.${id}&active=eq.true&select=phone,email&limit=1`);
  if (!res.ok) return null;
  const rows = (await res.json()) as { phone: string | null; email: string | null }[];
  return rows[0] ?? null;
}

// ── 2-day reminder (cron) ───────────────────────────────────────────────────
// Booked jobs landing on `date` that haven't had a reminder sent yet.
export async function listBookedForReminder(date: string): Promise<Quote[]> {
  if (!ISO_DATE.test(date)) return [];
  const res = await pgAdmin(
    `quote_requests?status=eq.booked&scheduled_date=eq.${date}&reminder_sent_at=is.null&select=*`,
  );
  if (!res.ok) return [];
  return (await res.json()) as Quote[];
}

export async function markReminderSent(id: string): Promise<void> {
  await pgAdmin(`quote_requests?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ reminder_sent_at: new Date().toISOString() }),
  });
}

// Activity-log entry written by automatic/server-only processes (no session).
export async function addAdminEvent(quoteId: string, type: string, meta?: Record<string, unknown>): Promise<void> {
  await pgAdmin("quote_events", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ quote_id: quoteId, type, meta: meta ?? null, actor: null }),
  });
}

// ── Customer confirmation from the reminder link (token-gated) ──────────────
export async function recordJobConfirmation(
  token: string,
  action: "confirm" | "reschedule",
): Promise<{ ok: boolean; error?: string; quote?: Quote }> {
  if (!/^[a-f0-9]{16,40}$/i.test(token)) return { ok: false, error: "Invalid link." };
  const res = await pgAdmin(`quote_requests?public_token=eq.${token}&select=*&limit=1`);
  if (!res.ok) return { ok: false, error: "Could not load your job." };
  const q = ((await res.json()) as Quote[])[0];
  if (!q) return { ok: false, error: "Job not found." };

  const patch: Partial<Quote> =
    action === "confirm" ? { status: "confirmed", confirmed_at: new Date().toISOString() } : {};

  if (Object.keys(patch).length > 0) {
    const upd = await pgAdmin(`quote_requests?id=eq.${q.id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(patch),
    });
    if (!upd.ok) return { ok: false, error: "Could not save. Please call us." };
  }

  await pgAdmin("quote_events", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      quote_id: q.id,
      type: action === "confirm" ? "customer_confirmed" : "customer_unconfirmed",
      meta: { scheduled_date: q.scheduled_date ?? null },
    }),
  });
  return { ok: true, quote: q };
}

export async function updateStaff(session: Session, id: string, patch: Partial<Staff>): Promise<boolean> {
  const res = await pgUser(`staff?id=eq.${encodeURIComponent(id)}`, session.accessToken, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });
  return res.ok;
}

export async function insertStaff(session: Session, row: Partial<Staff>): Promise<boolean> {
  const res = await pgUser("staff", session.accessToken, {
    method: "POST",
    headers: { Prefer: "return=minimal,resolution=merge-duplicates" },
    body: JSON.stringify(row),
  });
  return res.ok;
}

// ── Public token pages (service-role; no user session) ──────────────────────
export async function getQuoteByToken(column: "public_token" | "job_token", token: string): Promise<Quote | null> {
  if (!/^[a-f0-9]{16,40}$/i.test(token)) return null;
  const res = await pgAdmin(`quote_requests?${column}=eq.${token}&select=*&limit=1`);
  if (!res.ok) return null;
  const rows = (await res.json()) as Quote[];
  return rows[0] ?? null;
}

export async function recordCustomerView(token: string): Promise<void> {
  if (!/^[a-f0-9]{16,40}$/i.test(token)) return;
  const res = await pgAdmin(`quote_requests?public_token=eq.${token}&select=id,view_count,viewed_at,status&limit=1`);
  if (!res.ok) return;
  const rows = (await res.json()) as Pick<Quote, "id" | "view_count" | "viewed_at" | "status">[];
  const q = rows[0];
  if (!q) return;

  const patch: Partial<Quote> = { view_count: (q.view_count ?? 0) + 1 };
  if (!q.viewed_at) patch.viewed_at = new Date().toISOString();

  await pgAdmin(`quote_requests?id=eq.${q.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });
  await pgAdmin("quote_events", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ quote_id: q.id, type: "customer_viewed", meta: { at: new Date().toISOString() } }),
  });
}

// Customer accepts (with a scheduled date, optionally taking the $150 save offer)
// or declines, straight from the branded quote page. Service role; token-gated.
export async function recordCustomerResponse(
  token: string,
  input: { action: "accept" | "decline"; discount?: boolean; scheduledDate?: string },
): Promise<{ ok: boolean; error?: string }> {
  if (!/^[a-f0-9]{16,40}$/i.test(token)) return { ok: false, error: "Invalid link." };
  const res = await pgAdmin(
    `quote_requests?public_token=eq.${token}&select=id,quote_amount,customer_response,discount_accepted&limit=1`,
  );
  if (!res.ok) return { ok: false, error: "Could not load your quote." };
  const rows = (await res.json()) as Pick<Quote, "id" | "quote_amount" | "customer_response" | "discount_accepted">[];
  const q = rows[0];
  if (!q) return { ok: false, error: "Quote not found." };

  const patch: Partial<Quote> = { customer_responded_at: new Date().toISOString() };
  let eventType: string;

  if (input.action === "decline") {
    patch.customer_response = "declined";
    patch.status = "lost";
    eventType = "customer_declined";
  } else {
    const date = (input.scheduledDate || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "Please pick a valid date." };
    const picked = new Date(`${date}T00:00:00Z`).getTime();
    const min = Date.now() + 10 * 24 * 60 * 60 * 1000; // ~1.5 weeks (lenient by a day for time zones)
    if (!Number.isFinite(picked) || picked < min) {
      return { ok: false, error: "Please choose a date at least 1.5 weeks out." };
    }
    // One job per day. Don't let two customers book the same date.
    const alreadyBooked = await countJobsOn(date, q.id);
    if (alreadyBooked >= MAX_JOBS_PER_DAY) {
      return { ok: false, error: "That day is already booked. Please choose another date." };
    }
    patch.customer_response = "accepted";
    patch.status = "booked";
    patch.scheduled_date = date;
    if (input.discount && !q.discount_accepted) {
      patch.discount_accepted = true;
      if (q.quote_amount != null) {
        patch.quote_amount = Math.max(0, Math.round((Number(q.quote_amount) - DECLINE_CREDIT) * 100) / 100);
      }
    }
    eventType = "customer_accepted";
  }

  const upd = await pgAdmin(`quote_requests?id=eq.${q.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });
  if (!upd.ok) return { ok: false, error: "Could not save your response. Please call us." };

  await pgAdmin("quote_events", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      quote_id: q.id,
      type: eventType,
      meta: { discount: Boolean(input.discount), scheduled_date: patch.scheduled_date ?? null },
    }),
  });
  return { ok: true };
}

// Short-lived signed URL for one private storage object (path = "bucket/obj").
export async function signFile(storagePath: string, expiresIn = 3600): Promise<string | null> {
  const prefix = `${UPLOAD_BUCKET}/`;
  const obj = storagePath.startsWith(prefix) ? storagePath.slice(prefix.length) : storagePath;
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${UPLOAD_BUCKET}/${obj}`, {
    method: "POST",
    cache: "no-store",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { signedURL?: string };
  return json.signedURL ? `${SUPABASE_URL}/storage/v1${json.signedURL}` : null;
}

export async function signFiles(paths: string[], expiresIn = 3600): Promise<{ path: string; url: string | null }[]> {
  return Promise.all(paths.map(async (p) => ({ path: p, url: await signFile(p, expiresIn) })));
}
