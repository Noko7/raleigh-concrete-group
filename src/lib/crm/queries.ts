// Server-only data access for the CRM. Reads/writes that belong to a logged-in
// user go through pgUser (RLS enforces owner/contractor scoping). Token-page
// lookups, view tracking and signed URLs use pgAdmin (no user context).
import { DECLINE_CREDIT, LEAD_TIME_DAYS, MAX_PREFERRED_DATES } from "./constants";
import { SUPABASE_URL, SERVICE_KEY, UPLOAD_BUCKET, AGREEMENT_BUCKET } from "./env";
import { pgUser, pgAdmin } from "./rest";
import type {
  Agreement,
  ContractorInvite,
  LoginAttempt,
  Quote,
  QuoteEvent,
  Session,
  Staff,
} from "./types";

export type QuoteFilters = { status?: string; assignedTo?: string; search?: string; archived?: boolean };

// Archived (soft-deleted) leads are hidden from the pipeline/customers views by
// default - pass { archived: true } to see only the ones someone deleted.
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

// Same update, but it says why it failed. A bare null can't distinguish "the
// database is missing a column" from "RLS blocked you", and both used to surface
// to the crew as "Could not save that date. Please try again." - advice that
// never works, for a problem retrying can't fix.
export async function updateQuoteResult(
  session: Session,
  id: string,
  patch: Partial<Quote>,
): Promise<{ quote: Quote | null; error?: string }> {
  const res = await pgUser(`quote_requests?id=eq.${encodeURIComponent(id)}`, session.accessToken, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[updateQuote] failed", { id, status: res.status, body, patch: Object.keys(patch) });

    // PGRST204 = "column ... does not exist": a migration hasn't been run yet.
    // Name the file, because that's the only thing that fixes it.
    const missing = body.match(/'([a-z_]+)' column/i)?.[1] ?? body.match(/column "([a-z_]+)"/i)?.[1];
    if (body.includes("PGRST204") || /column .* does not exist/i.test(body)) {
      return {
        quote: null,
        error: `The database is missing the "${missing ?? "scheduled"}" column. Run the SQL in supabase/ (see README) and try again.`,
      };
    }
    if (res.status === 409) {
      return { quote: null, error: "Another job is already booked on that day." };
    }
    return { quote: null, error: `Could not save (error ${res.status}). Please try again or call the office.` };
  }

  const rows = (await res.json()) as Quote[];
  // A successful PATCH that changed nothing means RLS filtered the row out:
  // the job isn't assigned to this user any more.
  if (!rows[0]) {
    return {
      quote: null,
      error: "You can't change this job. It may have been reassigned to someone else.",
    };
  }
  return { quote: rows[0] };
}

export async function updateQuote(session: Session, id: string, patch: Partial<Quote>): Promise<Quote | null> {
  return (await updateQuoteResult(session, id, patch)).quote;
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
  patch: { full_name?: string | null; phone?: string | null; locale?: string },
): Promise<boolean> {
  const body: Record<string, unknown> = {};
  if (patch.full_name !== undefined) body.full_name = patch.full_name;
  if (patch.phone !== undefined) body.phone = patch.phone;
  if (patch.locale !== undefined) body.locale = patch.locale;
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
export async function getStaffContactById(
  id: string,
): Promise<{ phone: string | null; email: string | null; full_name: string | null } | null> {
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) return null;
  const res = await pgAdmin(`staff?id=eq.${id}&active=eq.true&select=phone,email,full_name&limit=1`);
  if (!res.ok) return null;
  const rows = (await res.json()) as { phone: string | null; email: string | null; full_name: string | null }[];
  return rows[0] ?? null;
}

// ── 2-day reminder (cron) ───────────────────────────────────────────────────
// Booked jobs landing on `date` that haven't had a reminder sent yet.
export async function listBookedForReminder(date: string): Promise<Quote[]> {
  if (!ISO_DATE.test(date)) return [];
  const res = await pgAdmin(
    `quote_requests?status=eq.scheduled&scheduled_date=eq.${date}&reminder_sent_at=is.null&select=*`,
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

// ── Crew reminders (cron) ───────────────────────────────────────────────────
// Booked jobs landing on `date`, whatever their confirmation state. Unlike the
// customer reminder there's no "sent" column to filter on here: which stages
// have gone out is tracked per job in crew_reminders, checked by the caller.
export async function listJobsOn(date: string): Promise<Quote[]> {
  if (!ISO_DATE.test(date)) return [];
  const res = await pgAdmin(`quote_requests?status=eq.scheduled&scheduled_date=eq.${date}&select=*`);
  if (!res.ok) return [];
  return (await res.json()) as Quote[];
}

// Wipe the countdown so a newly booked (or moved) date gets its own full run of
// crew reminders. Best-effort by design - see confirmSchedule.
export async function clearCrewReminders(id: string): Promise<void> {
  await pgAdmin(`quote_requests?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ crew_reminders: null }),
  }).catch(() => {});
}

// Record that the crew has had the reminder for this stage ("3", "1", "0").
// Stored as an array rather than three columns so adding a stage later is a
// constant change, not a migration. Re-confirming a date clears it.
export async function markCrewReminded(quote: Quote, stage: string): Promise<void> {
  const already = quote.crew_reminders ?? [];
  if (already.includes(stage)) return;
  await pgAdmin(`quote_requests?id=eq.${encodeURIComponent(quote.id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ crew_reminders: [...already, stage] }),
  }).catch(() => {});
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

  // Confirmation is now a flag on a Scheduled job (we keep the timestamp) rather
  // than its own pipeline stage, so the board stays simple.
  const patch: Partial<Quote> =
    action === "confirm" ? { confirmed_at: new Date().toISOString() } : {};

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
  input: { action: "accept" | "decline"; discount?: boolean; preferredDates?: string[] },
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
    // Approving no longer books a day. The customer proposes dates that suit
    // them and the job parks in "approved" until the crew confirms one against
    // their own schedule - that confirmation is what puts it on the calendar.
    const min = Date.now() + (LEAD_TIME_DAYS - 1) * 24 * 60 * 60 * 1000; // lenient by a day for time zones
    const seen = new Set<string>();
    const dates: string[] = [];
    for (const raw of input.preferredDates ?? []) {
      const date = String(raw).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || seen.has(date)) continue;
      const picked = new Date(`${date}T00:00:00Z`).getTime();
      if (!Number.isFinite(picked) || picked < min) continue;
      seen.add(date);
      dates.push(date);
      if (dates.length >= MAX_PREFERRED_DATES) break;
    }
    if (dates.length === 0) {
      return { ok: false, error: `Please pick at least one date ${LEAD_TIME_DAYS} days from now or later.` };
    }

    patch.customer_response = "accepted";
    patch.status = "approved";
    patch.preferred_dates = dates;
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
      meta: { discount: Boolean(input.discount), preferred_dates: patch.preferred_dates ?? null },
    }),
  });
  return { ok: true };
}

// Confirm (or move) the work day. Runs as the logged-in user so RLS keeps a
// contractor to their own assigned jobs, which is what lets the crew - not just
// the owner - lock in a date. Returns the previous date so the caller can tell a
// first booking apart from a reschedule when it sends the texts.
export async function confirmSchedule(
  session: Session,
  id: string,
  date: string,
  time: string,
): Promise<{ ok: boolean; error?: string; previous?: string | null; previousTime?: string | null; unchanged?: boolean }> {
  if (!ISO_DATE.test(date)) return { ok: false, error: "Pick a valid date." };
  // Display copy like "9:00 AM" - validated by shape so a tampered form can't
  // inject a paragraph into every text we send afterwards.
  if (!/^\d{1,2}:\d{2}\s?(AM|PM)$/i.test(time.trim())) return { ok: false, error: "Pick a start time." };
  const cleanTime = time.trim().toUpperCase().replace(/\s+/, " ");

  const current = await getQuote(session, id);
  if (!current) return { ok: false, error: "You don't have access to this job." };
  // A changed time on the same day is still a real change the customer needs to
  // hear about, so only short-circuit when both halves match.
  if (current.scheduled_date === date && current.scheduled_time === cleanTime) {
    return { ok: true, previous: date, previousTime: cleanTime, unchanged: true };
  }

  // One job per day - the DB enforces this too, but checking here gives a clear
  // message instead of a constraint violation.
  if ((await countJobsOn(date, id)) >= MAX_JOBS_PER_DAY) {
    return { ok: false, error: "Another job is already booked that day." };
  }

  const { quote: updated, error } = await updateQuoteResult(session, id, {
    scheduled_date: date,
    scheduled_time: cleanTime,
    status: current.status === "completed" || current.status === "paid" ? current.status : "scheduled",
    scheduled_by: session.staff.id,
    scheduled_at: new Date().toISOString(),
    // A moved date invalidates any confirmation the customer already gave.
    confirmed_at: null,
    reminder_sent_at: null,
  });
  if (!updated) return { ok: false, error: error ?? "Could not save that date. Please try again." };

  // Re-arm the crew countdown for the new date. Deliberately a separate,
  // best-effort write: booking the job is the thing that must not fail, and it
  // shouldn't start depending on a column added later for reminders.
  await clearCrewReminders(id);

  return { ok: true, previous: current.scheduled_date, previousTime: current.scheduled_time };
}

// Short-lived signed URL for one private storage object (path = "bucket/obj").
export async function signFile(storagePath: string, expiresIn = 3600): Promise<string | null> {
  const prefix = `${UPLOAD_BUCKET}/`;
  const obj = storagePath.startsWith(prefix) ? storagePath.slice(prefix.length) : storagePath;
  // Only sign objects inside our bucket; reject traversal / absolute paths.
  if (!obj || obj.includes("..") || obj.startsWith("/")) return null;
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

// ── Contractor invites ──────────────────────────────────────────────────────
// The token is a capability: whoever holds it can create one contractor
// account. It is long, random, single-use and expiring, and every lookup below
// re-checks all three conditions rather than trusting the caller.

export const INVITE_TTL_DAYS = 7;
const INVITE_TOKEN_RE = /^[a-f0-9]{32}$/;

export function newInviteToken(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

export async function createInvite(input: {
  token: string;
  phone: string;
  fullName?: string | null;
  createdBy: string;
}): Promise<boolean> {
  const expires = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const res = await pgAdmin("contractor_invites", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      token: input.token,
      phone: input.phone,
      full_name: input.fullName || null,
      created_by: input.createdBy,
      expires_at: expires,
    }),
  });
  return res.ok;
}

// Service-role lookup for the public onboarding page - there is no session at
// that point. Returns null for anything unusable (unknown, revoked, already
// used, expired) so the caller can't tell those cases apart and probe for
// valid tokens.
export async function getUsableInvite(token: string): Promise<ContractorInvite | null> {
  if (!INVITE_TOKEN_RE.test(token)) return null;
  const res = await pgAdmin(`contractor_invites?token=eq.${token}&select=*&limit=1`);
  if (!res.ok) return null;
  const rows = (await res.json()) as ContractorInvite[];
  const invite = rows[0];
  if (!invite) return null;
  if (invite.used_at || invite.revoked_at) return null;
  if (new Date(invite.expires_at).getTime() < Date.now()) return null;
  return invite;
}

// Burn the invite. Conditional on used_at still being null so two submissions
// racing each other can't both create an account: PostgREST returns the rows it
// actually changed, so an empty result means someone else got there first.
export async function consumeInvite(id: string, staffId: string): Promise<boolean> {
  const res = await pgAdmin(`contractor_invites?id=eq.${encodeURIComponent(id)}&used_at=is.null`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ used_at: new Date().toISOString(), used_by: staffId }),
  });
  if (!res.ok) return false;
  const rows = (await res.json()) as unknown[];
  return rows.length > 0;
}

// Record that the link was opened. Best-effort and fire-and-forget: this is
// telemetry for the owner, so it must never stop a contractor from onboarding.
export async function markInviteOpened(invite: ContractorInvite): Promise<void> {
  await pgAdmin(`contractor_invites?id=eq.${encodeURIComponent(invite.id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      opened_at: invite.opened_at ?? new Date().toISOString(),
      open_count: (invite.open_count ?? 0) + 1,
    }),
  }).catch(() => {});
}

export async function listInvites(session: Session, limit = 50): Promise<ContractorInvite[]> {
  const res = await pgUser(
    `contractor_invites?select=*&order=created_at.desc&limit=${limit}`,
    session.accessToken,
  );
  if (!res.ok) return [];
  return (await res.json()) as ContractorInvite[];
}

export async function revokeInvite(id: string): Promise<boolean> {
  const res = await pgAdmin(`contractor_invites?id=eq.${encodeURIComponent(id)}&used_at=is.null`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ revoked_at: new Date().toISOString() }),
  });
  return res.ok;
}

// ── Agreements (contracts sent for signature through DocuSeal) ──────────────
// All of these go through pgUser so RLS does the authorization: an owner sees
// every agreement, a contractor only their own onboarding doc and the customer
// agreements for jobs assigned to them.

export async function listAgreementsForQuote(session: Session, quoteId: string): Promise<Agreement[]> {
  const res = await pgUser(
    `agreements?quote_id=eq.${encodeURIComponent(quoteId)}&select=*&order=created_at.desc`,
    session.accessToken,
  );
  if (!res.ok) return [];
  return (await res.json()) as Agreement[];
}

export async function listAgreementsForStaff(session: Session, staffId: string): Promise<Agreement[]> {
  const res = await pgUser(
    `agreements?staff_id=eq.${encodeURIComponent(staffId)}&select=*&order=created_at.desc`,
    session.accessToken,
  );
  if (!res.ok) return [];
  return (await res.json()) as Agreement[];
}

export async function listAllAgreements(session: Session): Promise<Agreement[]> {
  const res = await pgUser("agreements?select=*&order=created_at.desc", session.accessToken);
  if (!res.ok) return [];
  return (await res.json()) as Agreement[];
}

export async function getAgreement(session: Session, id: string): Promise<Agreement | null> {
  const res = await pgUser(
    `agreements?id=eq.${encodeURIComponent(id)}&select=*&limit=1`,
    session.accessToken,
  );
  if (!res.ok) return null;
  const rows = (await res.json()) as Agreement[];
  return rows[0] ?? null;
}

export async function insertAgreement(session: Session, row: Partial<Agreement>): Promise<Agreement | null> {
  const res = await pgUser("agreements", session.accessToken, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  if (!res.ok) return null;
  const rows = (await res.json()) as Agreement[];
  return rows[0] ?? null;
}

export async function updateAgreement(
  session: Session,
  id: string,
  patch: Partial<Agreement>,
): Promise<boolean> {
  const res = await pgUser(`agreements?id=eq.${encodeURIComponent(id)}`, session.accessToken, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });
  return res.ok;
}

export async function deleteAgreement(session: Session, id: string): Promise<boolean> {
  const res = await pgUser(`agreements?id=eq.${encodeURIComponent(id)}`, session.accessToken, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
  return res.ok;
}

// Remove the stored file for an agreement. Best-effort: the row is the source of
// truth, an orphaned object in the bucket is harmless.
export async function deleteAgreementFile(path: string): Promise<void> {
  const prefix = `${AGREEMENT_BUCKET}/`;
  const obj = path.startsWith(prefix) ? path.slice(prefix.length) : path;
  if (!obj || obj.includes("..") || obj.startsWith("/")) return;
  await fetch(`${SUPABASE_URL}/storage/v1/object/${AGREEMENT_BUCKET}/${obj}`, {
    method: "DELETE",
    cache: "no-store",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  }).catch(() => {});
}

// ── Login attempts (owner-visible security log) ─────────────────────────────
// Written from /crm/api/login with the service-role key - there's no user
// session yet at login time, success or failure.
export async function logLoginAttempt(input: {
  email: string;
  success: boolean;
  reason: string;
  staffId?: string | null;
  ip: string;
  userAgent: string | null;
}): Promise<void> {
  await pgAdmin("login_attempts", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      email: input.email || null,
      success: input.success,
      reason: input.reason,
      staff_id: input.staffId ?? null,
      ip: input.ip,
      user_agent: input.userAgent,
    }),
  });
}

// `since` (ISO timestamp) bounds the window so the per-person sign-in stats on
// the Security dashboard aren't silently truncated by the row limit.
export async function listLoginAttempts(
  session: Session,
  limit = 300,
  since?: string,
): Promise<LoginAttempt[]> {
  const params = new URLSearchParams({ select: "*", order: "created_at.desc", limit: String(limit) });
  if (since) params.set("created_at", `gte.${since}`);
  const res = await pgUser(`login_attempts?${params.toString()}`, session.accessToken);
  if (!res.ok) return [];
  return (await res.json()) as LoginAttempt[];
}

// ── Platform activity (who did what, across every job) ──────────────────────
// RLS scopes this the same way as the per-job timeline: owners see everything,
// a contractor only events on jobs assigned to them.
export async function listRecentActivity(session: Session, limit = 250): Promise<QuoteEvent[]> {
  const res = await pgUser(
    `quote_events?select=*&order=created_at.desc&limit=${limit}`,
    session.accessToken,
  );
  if (!res.ok) return [];
  return (await res.json()) as QuoteEvent[];
}

// Resolve job names for an activity feed in one round trip. Done as an explicit
// second query rather than a PostgREST embed so it still works for events whose
// job has since been archived.
export async function getQuoteNames(session: Session, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const list = unique.map((id) => encodeURIComponent(id)).join(",");
  const res = await pgUser(`quote_requests?id=in.(${list})&select=id,name`, session.accessToken);
  if (!res.ok) return new Map();
  const rows = (await res.json()) as { id: string; name: string }[];
  return new Map(rows.map((r) => [r.id, r.name]));
}
