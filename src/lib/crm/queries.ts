// Server-only CRM data access. User-scoped calls use pgUser (RLS scopes owner vs
// contractor); token pages, view tracking and signed URLs use pgAdmin.
import { offlineAcceptanceRefusal, repeatAnswer, unansweredFilter } from "./answered";
import { ymdInDays } from "./clock";
import {
  CHANGE_NOTE_MAX,
  DECLINE_CREDIT,
  DEFAULT_WORK_HOURS,
  LEAD_TIME_DAYS,
  MAX_PREFERRED_DATES,
  MAX_QUOTE_OPTIONS,
  MAX_QUOTE_PACKAGES,
  OPTION_DESC_MAX,
  OPTION_TITLE_MAX,
  PACKAGE_DESC_MAX,
  PACKAGE_TITLE_MAX,
  TIME_RE,
  VISIT_GAP_MINUTES,
  isChoice,
  minutesOfTime,
  noEmDash,
  optionAmount,
  optionsTotal,
  readWorkHours,
  slotsFor,
  visitDateOf,
  worksOn,
  boughtLines,
  changeStartLines,
  sameChangeLines,
  type QuoteOptionDraft,
  type QuotePackageDraft,
  type WorkHours,
  VISIT_GRACE_DAYS,
} from "./constants";
import { SUPABASE_URL, SERVICE_KEY, UPLOAD_BUCKET, AGREEMENT_BUCKET } from "./env";
// fees.ts imports nothing local, so this can't form a cycle.
import { toCents } from "./fees";
import { changeOrderRefusal, jobPatchRefusal, refusalBasis } from "./permissions";
import { pgUser, pgAdmin } from "./rest";
import { MAX_SEND_ATTEMPTS, RETRY_BACKOFF_MINUTES, planRetry } from "./send-retry";

export { MAX_SEND_ATTEMPTS };
import type {
  Agreement,
  ContractorInvite,
  LoginAttempt,
  Quote,
  QuoteEvent,
  QuoteOption,
  QuotePackage,
  Session,
  Staff,
} from "./types";

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

// ── Quote line items ────────────────────────────────────────────────────────
// A quote has none (single price) or several, each answered separately.

export async function listQuoteOptions(session: Session, quoteId: string): Promise<QuoteOption[]> {
  const res = await pgUser(
    `quote_options?quote_id=eq.${encodeURIComponent(quoteId)}&select=*&order=sort_order.asc,created_at.asc`,
    session.accessToken,
  );
  // Any failure reads as "no line items", which is right for every caller.
  if (!res.ok) {
    console.error("[quoteOptions] list failed", { quoteId, status: res.status });
    return [];
  }
  return (await res.json()) as QuoteOption[];
}

// Service-role version for the customer's quote page and its endpoint (no session).
export async function listQuoteOptionsAdmin(quoteId: string): Promise<QuoteOption[]> {
  const res = await pgAdmin(
    `quote_options?quote_id=eq.${encodeURIComponent(quoteId)}&select=*&order=sort_order.asc,created_at.asc`,
  );
  if (!res.ok) {
    console.error("[quoteOptions] list failed", { quoteId, status: res.status });
    return [];
  }
  return (await res.json()) as QuoteOption[];
}

// Both editors post this JSON and neither is trusted: caps are enforced here as
// well as by the check constraint.
export function parseQuoteOptions(raw: unknown): { rows: QuoteOptionDraft[]; error?: string } {
  if (!Array.isArray(raw)) return { rows: [] };
  const rows: QuoteOptionDraft[] = [];
  for (const item of raw.slice(0, MAX_QUOTE_OPTIONS)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const title = noEmDash(String(o.title ?? "").trim()).slice(0, OPTION_TITLE_MAX);
    // A blank row is an abandoned add; drop it rather than refuse.
    if (!title) continue;
    const amount = Number(o.amount);
    if (!Number.isFinite(amount) || amount < 0 || amount > 99_999_999) {
      return { rows: [], error: `Enter a valid price for "${title}".` };
    }
    const id = typeof o.id === "string" && /^[0-9a-f-]{36}$/i.test(o.id) ? o.id : undefined;
    rows.push({
      id,
      title,
      description: noEmDash(String(o.description ?? "").trim()).slice(0, OPTION_DESC_MAX),
      amount: Math.round(amount * 100) / 100,
      required: o.required === true,
    });
  }
  return { rows };
}

// Same line items as the customer would read them; separates a correction from
// a resend of the same quote.
export function sameOptions(a: QuoteOptionDraft[], b: QuoteOptionDraft[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b[i];
    return (
      x.title === y.title &&
      x.description === y.description &&
      Number(x.amount) === Number(y.amount) &&
      x.required === y.required
    );
  });
}

// Stored rows in parseQuoteOptions' shape, for comparison.
export function optionsAsDrafts(rows: QuoteOption[]): QuoteOptionDraft[] {
  return rows.map((o) => ({
    id: o.id,
    title: o.title,
    description: o.description ?? "",
    amount: Number(o.amount),
    required: o.required,
  }));
}

// Sync stored line items to the submission. Rows keep their id (and the
// customer's answer). Runs as the user, so RLS stops edits to others' jobs.
export async function saveQuoteOptions(
  session: Session,
  quoteId: string,
  rows: QuoteOptionDraft[],
): Promise<{ ok: boolean; error?: string }> {
  const existing = await listQuoteOptions(session, quoteId);
  const byId = new Map(existing.map((o) => [o.id, o]));
  const keep = new Set(rows.map((r) => r.id).filter((id): id is string => Boolean(id && byId.has(id))));

  const gone = existing.filter((o) => !keep.has(o.id)).map((o) => o.id);
  if (gone.length > 0) {
    const res = await pgUser(`quote_options?id=in.(${gone.join(",")})`, session.accessToken, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
    if (!res.ok) return { ok: false, error: await optionError(res, "remove") };
  }

  const inserts: Record<string, unknown>[] = [];
  for (const [i, r] of rows.entries()) {
    const current = r.id ? byId.get(r.id) : undefined;
    const body = {
      title: r.title,
      description: r.description || null,
      amount: r.amount,
      required: r.required,
      sort_order: i,
    };
    if (!current) {
      inserts.push({ quote_id: quoteId, ...body });
      continue;
    }
    const unchanged =
      current.title === body.title &&
      (current.description ?? null) === body.description &&
      Number(current.amount) === body.amount &&
      current.required === body.required &&
      current.sort_order === i;
    if (unchanged) continue;
    const res = await pgUser(`quote_options?id=eq.${current.id}`, session.accessToken, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { ok: false, error: await optionError(res, "save") };
  }

  if (inserts.length > 0) {
    const res = await pgUser("quote_options", session.accessToken, {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(inserts),
    });
    if (!res.ok) return { ok: false, error: await optionError(res, "save") };
  }

  return { ok: true };
}

async function optionError(res: Response, verb: string): Promise<string> {
  const body = await res.text().catch(() => "");
  console.error("[quoteOptions] failed", { status: res.status, body });
  return `Could not ${verb} the line items (error ${res.status}). Please try again.`;
}

// ── Packages: pick exactly one ──────────────────────────────────────────────
// "Or instead" to line items' "and also" (concrete vs asphalt). Mirrors the
// line-item block deliberately: same scoping and error handling.

export async function listQuotePackages(session: Session, quoteId: string): Promise<QuotePackage[]> {
  const res = await pgUser(
    `quote_packages?quote_id=eq.${encodeURIComponent(quoteId)}&select=*&order=sort_order.asc,created_at.asc`,
    session.accessToken,
  );
  // Any failure reads as "no choice offered", which is right for every caller.
  if (!res.ok) {
    console.error("[quotePackages] list failed", { quoteId, status: res.status });
    return [];
  }
  return (await res.json()) as QuotePackage[];
}

// Service-role version for the customer's quote page and its endpoint (no session).
export async function listQuotePackagesAdmin(quoteId: string): Promise<QuotePackage[]> {
  const res = await pgAdmin(
    `quote_packages?quote_id=eq.${encodeURIComponent(quoteId)}&select=*&order=sort_order.asc,created_at.asc`,
  );
  if (!res.ok) {
    console.error("[quotePackages] list failed", { quoteId, status: res.status });
    return [];
  }
  return (await res.json()) as QuotePackage[];
}

// Same rules as parseQuoteOptions, plus: at most one recommended. The DB's
// partial unique index enforces it too; later ones just lose the flag so the
// browser gets a sentence, not a constraint error.
export function parseQuotePackages(raw: unknown): { rows: QuotePackageDraft[]; error?: string } {
  if (!Array.isArray(raw)) return { rows: [] };
  const rows: QuotePackageDraft[] = [];
  let recommended = false;
  for (const item of raw.slice(0, MAX_QUOTE_PACKAGES)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const title = noEmDash(String(o.title ?? "").trim()).slice(0, PACKAGE_TITLE_MAX);
    // A blank card is an abandoned add; drop it rather than refuse.
    if (!title) continue;
    const amount = Number(o.amount);
    if (!Number.isFinite(amount) || amount < 0 || amount > 99_999_999) {
      return { rows: [], error: `Enter a price for "${title}".` };
    }
    const id = typeof o.id === "string" && /^[0-9a-f-]{36}$/i.test(o.id) ? o.id : undefined;
    const isRec = o.recommended === true && !recommended;
    if (isRec) recommended = true;
    rows.push({
      id,
      title,
      description: noEmDash(String(o.description ?? "").trim()).slice(0, PACKAGE_DESC_MAX),
      amount: Math.round(amount * 100) / 100,
      recommended: isRec,
    });
  }
  // A lone card is kept so a half-typed choice isn't lost on save. It's inert
  // until there's a second: isChoice() gates pricing, the customer page and send.
  return { rows };
}

// Same choice as the customer would read it; separates a correction from a
// resend of the same quote.
export function samePackages(a: QuotePackageDraft[], b: QuotePackageDraft[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b[i];
    return (
      x.title === y.title &&
      x.description === y.description &&
      Number(x.amount) === Number(y.amount) &&
      x.recommended === y.recommended
    );
  });
}

// Stored rows in parseQuotePackages' shape, for comparison.
export function packagesAsDrafts(rows: QuotePackage[]): QuotePackageDraft[] {
  return rows.map((p) => ({
    id: p.id,
    title: p.title,
    description: p.description ?? "",
    amount: Number(p.amount),
    recommended: p.recommended,
  }));
}

// Sync stored packages to the submission. Rows keep their id (and the
// customer's answer). Runs as the user, so RLS stops edits to others' jobs.
export async function saveQuotePackages(
  session: Session,
  quoteId: string,
  rows: QuotePackageDraft[],
): Promise<{ ok: boolean; error?: string }> {
  const existing = await listQuotePackages(session, quoteId);
  const byId = new Map(existing.map((p) => [p.id, p]));
  const keep = new Set(rows.map((r) => r.id).filter((id): id is string => Boolean(id && byId.has(id))));

  const gone = existing.filter((p) => !keep.has(p.id)).map((p) => p.id);
  if (gone.length > 0) {
    const res = await pgUser(`quote_packages?id=in.(${gone.join(",")})`, session.accessToken, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
    if (!res.ok) return { ok: false, error: await packageError(res, "remove") };
  }

  // Clear recommendations first: the partial unique index allows one per
  // quote, so moving the flag would otherwise collide.
  const stillRecommended = existing.filter((p) => p.recommended && keep.has(p.id)).map((p) => p.id);
  if (stillRecommended.length > 0) {
    await pgUser(`quote_packages?id=in.(${stillRecommended.join(",")})`, session.accessToken, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ recommended: false }),
    });
  }

  const inserts: Record<string, unknown>[] = [];
  for (const [i, r] of rows.entries()) {
    const current = r.id ? byId.get(r.id) : undefined;
    const body = {
      title: r.title,
      description: r.description || null,
      amount: r.amount,
      recommended: r.recommended,
      sort_order: i,
    };
    if (!current) {
      inserts.push({ quote_id: quoteId, ...body });
      continue;
    }
    const res = await pgUser(`quote_packages?id=eq.${current.id}`, session.accessToken, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { ok: false, error: await packageError(res, "save") };
  }

  if (inserts.length > 0) {
    const res = await pgUser("quote_packages", session.accessToken, {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(inserts),
    });
    if (!res.ok) return { ok: false, error: await packageError(res, "save") };
  }

  return { ok: true };
}

async function packageError(res: Response, verb: string): Promise<string> {
  const body = await res.text().catch(() => "");
  console.error("[quotePackages] failed", { status: res.status, body });
  return `Could not ${verb} the options (error ${res.status}). Please try again.`;
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

// Service role so a contractor can edit their own row; restricted to their id
// and to name/phone/locale/hours. Never role or active.
export async function updateOwnProfile(
  session: Session,
  patch: {
    full_name?: string | null;
    phone?: string | null;
    locale?: string;
    work_start_hour?: number;
    work_end_hour?: number;
    work_days?: number[];
  },
): Promise<boolean> {
  const body: Record<string, unknown> = {};
  if (patch.full_name !== undefined) body.full_name = patch.full_name;
  if (patch.phone !== undefined) body.phone = patch.phone;
  if (patch.locale !== undefined) body.locale = patch.locale;
  if (patch.work_start_hour !== undefined) body.work_start_hour = patch.work_start_hour;
  if (patch.work_end_hour !== undefined) body.work_end_hour = patch.work_end_hour;
  if (patch.work_days !== undefined) body.work_days = patch.work_days;
  if (Object.keys(body).length === 0) return true;
  const res = await pgAdmin(`staff?id=eq.${encodeURIComponent(session.staff.id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  return res.ok;
}

// Every active owner gets all notifications. Service role: /api/quote has no session.
export async function getOwnerPhones(): Promise<string[]> {
  return (await getOwnerContacts()).map((o) => o.phone);
}

// With names, so Settings can say whose number is whose.
export async function getOwnerContacts(): Promise<{ name: string; phone: string }[]> {
  const res = await pgAdmin("staff?role=eq.owner&active=eq.true&select=full_name,email,phone");
  if (!res.ok) return [];
  const rows = (await res.json()) as { full_name: string | null; email: string | null; phone: string | null }[];
  return rows
    .filter((r) => typeof r.phone === "string" && r.phone.trim() !== "")
    .map((r) => ({ name: r.full_name || r.email || "Owner", phone: r.phone as string }));
}

// ── Message log ─────────────────────────────────────────────────────────────
// Every attempted text gets a row, sent or not. Sends are best-effort (an SMS
// outage must never fail a submission), and this is the trace next to the job.

// `kind` names the notification; `role` is who it was aimed at.
export type SmsLog = { quoteId?: string | null; kind: string; role: "customer" | "owner" | "crew" };

export type QuoteMessage = {
  id: string;
  quote_id: string | null;
  created_at: string;
  kind: string;
  role: string;
  to_phone: string | null;
  body: string | null;
  ok: boolean;
  provider: string | null;
  status: number | null;
  detail: string | null;
  // Quiet-hours hold: when it may go out, and when the queue sent it. Null on
  // texts sent immediately.
  send_after?: string | null;
  sent_at?: string | null;
  // Staff called it back before it sent; the row stays.
  cancelled_at?: string | null;
  // Provider hand-offs so far; a failed send is requeued until MAX_SEND_ATTEMPTS.
  attempts?: number | null;
};

// Waiting for its send time, or due and not yet flushed. Cancelled rows aren't
// held (they never will send).
export function isHeld(m: QuoteMessage): boolean {
  return Boolean(m.send_after) && !m.sent_at && !m.cancelled_at;
}

// Called back by staff before sending. Not a failure.
export function isCancelled(m: QuoteMessage): boolean {
  return Boolean(m.cancelled_at) && !m.sent_at;
}

/**
 * Still stoppable: held, and send_after is still in the future. Narrower than
 * isHeld: once due, the next flush may already have it, and Cancel would race.
 */
export function isCancellable(m: QuoteMessage, now: Date = new Date()): boolean {
  if (!isHeld(m)) return false;
  const due = new Date(m.send_after as string).getTime();
  return Number.isFinite(due) && due > now.getTime();
}

/**
 * Has this exact text gone to this number just now? Guards against a server
 * action running twice (double submit, retry), which the action itself can't
 * detect. Matched on number + body, since that's what the customer sees twice.
 * The window is short so a deliberate later resend still works. Held copies
 * count; cancelled ones don't.
 */
export async function recentlySent(toPhone: string, body: string, withinSeconds = 90): Promise<boolean> {
  try {
    const since = new Date(Date.now() - withinSeconds * 1000).toISOString();
    const res = await pgAdmin(
      `quote_messages?to_phone=eq.${encodeURIComponent(toPhone)}` +
        `&created_at=gte.${encodeURIComponent(since)}&cancelled_at=is.null` +
        `&select=body&order=created_at.desc&limit=20`,
    );
    if (!res.ok) return false;
    const rows = (await res.json()) as { body: string | null }[];
    return rows.some((r) => r.body === body);
  } catch {
    // Never block a send on the guard failing; a missed text is worse than a duplicate.
    return false;
  }
}

// Service-role: sends come from the public endpoint and cron, with no session.
// Never throws, so a logging failure can't take a send down with it.
export async function logMessage(row: {
  quote_id?: string | null;
  kind: string;
  role: string;
  to_phone?: string | null;
  body?: string | null;
  ok: boolean;
  provider?: string | null;
  status?: number | null;
  detail?: string | null;
  // Quiet-hours hold only: this row is also the queue entry, due then.
  send_after?: string | null;
  // Resolves to whether the row was written. Load-bearing for a held text:
  // false means nothing will ever send it.
}): Promise<boolean> {
  try {
    const res = await pgAdmin("quote_messages", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        quote_id: row.quote_id ?? null,
        kind: row.kind,
        role: row.role,
        to_phone: row.to_phone ?? null,
        // Capped: for reading back, not archiving.
        body: row.body ? row.body.slice(0, 4000) : null,
        ok: row.ok,
        provider: row.provider ?? null,
        status: row.status ?? null,
        detail: row.detail ? row.detail.slice(0, 2000) : null,
        ...(row.send_after ? { send_after: row.send_after } : {}),
      }),
    });
    if (!res.ok) {
      // A missing table would otherwise make every send look fine while nothing is recorded.
      console.error("[sms-log] could not record message", { status: res.status, kind: row.kind });
    }
    return res.ok;
  } catch (e) {
    console.error("[sms-log] threw", e);
    return false;
  }
}

// ── The quiet-hours queue ───────────────────────────────────────────────────
// Texts raised 7pm-8am wait here with a send_after. notify.ts's flush lists
// what's due, claims one, then records the outcome.

export async function listDueMessages(nowIso: string, limit = 25): Promise<QuoteMessage[]> {
  const res = await pgAdmin(
    `quote_messages?sent_at=is.null&cancelled_at=is.null&send_after=lte.${encodeURIComponent(nowIso)}` +
      `&select=*&order=send_after.asc&limit=${limit}`,
  );
  // Throws rather than returning []: an unreadable queue must not look empty,
  // or held texts silently stop going out.
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`Could not read the held-message queue (HTTP ${res.status}). ${detail}`.trim());
  }
  return (await res.json()) as QuoteMessage[];
}

/**
 * Claim a queued message; false if someone else got it. Crons and passing
 * requests can race for one row, so `sent_at=is.null` decides the winner.
 * Stamped before sending: a crash leaves a text unsent rather than sent twice.
 * `cancelled_at=is.null` lets a cancel landing between list and claim win.
 */
export async function claimMessage(id: string, nowIso: string): Promise<boolean> {
  try {
    const res = await pgAdmin(`quote_messages?id=eq.${encodeURIComponent(id)}&sent_at=is.null&cancelled_at=is.null`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ sent_at: nowIso }),
    });
    if (!res.ok) return false;
    return ((await res.json()) as unknown[]).length > 0;
  } catch {
    return false;
  }
}

export async function finishMessage(
  id: string,
  result: {
    ok: boolean;
    provider?: string | null;
    status?: number | null;
    detail?: string | null;
    unsent?: boolean;
  },
  attempts = 0,
): Promise<void> {
  const plan = planRetry(result, attempts);
  const detail = [result.detail, plan.note].filter(Boolean).join(" ") || null;
  const outcome = {
    ok: result.ok,
    provider: result.provider ?? null,
    status: result.status ?? null,
    detail: detail ? detail.slice(0, 2000) : null,
  };
  const patch = (body: Record<string, unknown>) =>
    pgAdmin(`quote_messages?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(body),
    });

  try {
    const res = await patch({
      ...outcome,
      attempts: plan.attempts,
      // Releasing the claim lets the next drain see it again.
      ...(plan.retrying
        ? { sent_at: null, send_after: new Date(Date.now() + RETRY_BACKOFF_MINUTES * 60_000).toISOString() }
        : {}),
    });
    if (!res.ok) {
      // Recording the outcome matters more than the retry bookkeeping, so try it on its own.
      console.error("[sms-queue] could not record the result of a held message", { status: res.status });
      await patch(outcome);
    }
  } catch (e) {
    console.error("[sms-queue] could not record the result of a held message", e);
  }
}

/**
 * Held-queue state for the Settings diagnostic. `overdue` > 0 means whatever
 * drains the queue isn't running.
 */
export type QueueHealth = { waiting: number; overdue: number; oldestDueIso: string | null; error?: string };

export async function queueHealth(at: Date = new Date()): Promise<QueueHealth> {
  const empty: QueueHealth = { waiting: 0, overdue: 0, oldestDueIso: null };
  try {
    const res = await pgAdmin(
      `quote_messages?sent_at=is.null&cancelled_at=is.null&send_after=not.is.null` +
        `&select=send_after&order=send_after.asc&limit=200`,
    );
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      return { ...empty, error: `HTTP ${res.status}. ${detail}`.trim() };
    }
    const rows = (await res.json()) as { send_after: string | null }[];
    // Parse, don't string-compare: Postgres returns "+00:00" while toISOString()
    // writes ".000Z", and those sort on punctuation, not time.
    const cutoff = at.getTime();
    const due = rows.filter((r) => {
      const t = r.send_after ? new Date(r.send_after).getTime() : NaN;
      return Number.isFinite(t) && t <= cutoff;
    });
    return {
      waiting: rows.length,
      overdue: due.length,
      oldestDueIso: due[0]?.send_after ?? null,
    };
  } catch (e) {
    return { ...empty, error: String(e) };
  }
}

/**
 * Call a queued text back; null if too late or never queued. Service role
 * because staff can only SELECT the log; the caller has checked job access.
 */
export async function cancelMessage(id: string, quoteId: string, nowIso: string): Promise<QuoteMessage | null> {
  try {
    const res = await pgAdmin(
      // send_after in the future is the eligibility rule, enforced by the DB:
      // once due, the flush may already hold the row and a cancel would race.
      `quote_messages?id=eq.${encodeURIComponent(id)}&quote_id=eq.${encodeURIComponent(quoteId)}` +
        `&sent_at=is.null&cancelled_at=is.null&send_after=gt.${encodeURIComponent(nowIso)}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ cancelled_at: nowIso, detail: "Cancelled by staff before it went out." }),
      },
    );
    if (!res.ok) return null;
    // Returned so the activity log can name which text was stopped.
    return ((await res.json()) as QuoteMessage[])[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Cancel every queued text for a job. Retracting a quote must also stop a text
 * held overnight about it. Returns how many were stopped.
 */
export async function cancelQueuedFor(quoteId: string, nowIso: string): Promise<number> {
  try {
    const res = await pgAdmin(
      `quote_messages?quote_id=eq.${encodeURIComponent(quoteId)}` +
        `&sent_at=is.null&cancelled_at=is.null&send_after=not.is.null`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ cancelled_at: nowIso, detail: "Cancelled: the quote was retracted." }),
      },
    );
    if (!res.ok) return 0;
    return ((await res.json()) as unknown[]).length;
  } catch {
    return 0;
  }
}

// Service role; the caller has already checked it can open the job.
export async function getMessage(id: string, quoteId: string): Promise<QuoteMessage | null> {
  const res = await pgAdmin(
    `quote_messages?id=eq.${encodeURIComponent(id)}&quote_id=eq.${encodeURIComponent(quoteId)}&select=*&limit=1`,
  );
  if (!res.ok) return null;
  return ((await res.json()) as QuoteMessage[])[0] ?? null;
}

export async function listMessages(session: Session, quoteId: string): Promise<QuoteMessage[]> {
  const res = await pgUser(
    `quote_messages?quote_id=eq.${encodeURIComponent(quoteId)}&select=*&order=created_at.desc&limit=200`,
    session.accessToken,
  );
  if (!res.ok) return [];
  return (await res.json()) as QuoteMessage[];
}

// Latest attempt of one kind. Only the log can tell "texted" from "tried and bounced".
export async function lastMessageOf(session: Session, quoteId: string, kind: string): Promise<QuoteMessage | null> {
  const res = await pgUser(
    `quote_messages?quote_id=eq.${encodeURIComponent(quoteId)}&kind=eq.${encodeURIComponent(kind)}` +
      `&select=*&order=created_at.desc&limit=1`,
    session.accessToken,
  );
  if (!res.ok) return null;
  return ((await res.json()) as QuoteMessage[])[0] ?? null;
}

// ── Booking capacity ────────────────────────────────────────────────────────
// One booked work day per day for the whole business: one crew, one truck.
// Quote visits have no per-day cap; they're limited per contractor by working
// hours and spacing (see visitAvailability).
export const MAX_JOBS_PER_DAY = 1;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-fA-F-]{36}$/;

// Work jobs already booked on a date (accepted, not Lost). Optionally excludes
// one quote so re-accepting doesn't count against itself. Lost is excluded so
// an abandoned booking doesn't block the day forever; the unique index in
// appointments.sql matches.
export async function countJobsOn(date: string, excludeId?: string): Promise<number> {
  if (!ISO_DATE.test(date)) return 0;
  let path = `quote_requests?scheduled_date=eq.${date}&customer_response=eq.accepted&status=neq.lost&select=id`;
  if (excludeId && /^[0-9a-fA-F-]{36}$/.test(excludeId)) path += `&id=neq.${excludeId}`;
  const res = await pgAdmin(path);
  if (!res.ok) return 0;
  return ((await res.json()) as unknown[]).length;
}

// ── Double-booking: one contractor, one place at a time ─────────────────────
// The per-day cap is business-wide; these stop one person being double-booked.
// Every path that commits a date runs one of them first.

export type Commitment = {
  id: string;
  name: string;
  kind: "job" | "visit";
  time: string | null;
};

// Everything one contractor is committed to on a date.
//
// A null staffId is the unassigned pile, treated as one shared calendar:
// routing can fail to pick anyone, and whoever ends up owning two 10am bookings
// is the same person.
//
// Not counted: an online request's visit_date (only an offered slot) and Lost jobs.
export async function contractorCommitments(
  staffId: string | null,
  date: string,
  excludeId?: string,
): Promise<Commitment[]> {
  if (!ISO_DATE.test(date)) return [];
  if (staffId !== null && !UUID_RE.test(staffId)) return [];
  const who = staffId === null ? "assigned_to=is.null" : `assigned_to=eq.${staffId}`;
  const res = await pgAdmin(
    `quote_requests?${who}&status=neq.lost` +
      `&or=(scheduled_date.eq.${date},visit_date.eq.${date})` +
      `&select=id,name,quote_type,customer_response,scheduled_date,scheduled_time,visit_date,visit_time`,
  );
  if (!res.ok) return [];
  const rows = (await res.json()) as {
    id: string;
    name: string;
    quote_type: string | null;
    customer_response: string | null;
    scheduled_date: string | null;
    scheduled_time: string | null;
    visit_date: string | null;
    visit_time: string | null;
  }[];

  const out: Commitment[] = [];
  for (const r of rows) {
    if (excludeId && r.id === excludeId) continue;
    if (r.scheduled_date === date && r.customer_response === "accepted") {
      out.push({ id: r.id, name: r.name, kind: "job", time: r.scheduled_time });
    }
    // visitDateOf's rule: only an in-person (or legacy null) visit is a commitment.
    if (r.visit_date === date && visitDateOf(r)) {
      out.push({ id: r.id, name: r.name, kind: "visit", time: r.visit_time });
    }
  }
  return out;
}

const clockKey = (t?: string | null) => (t ?? "").trim().toUpperCase().replace(/\s+/g, " ");

// Too close on one person's day? Distance between start times (not slot
// overlap), so an odd 9:30 blocks both 9:00 and 10:00. Unparseable times fall
// back to exact string match rather than letting everything through.
function tooClose(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = minutesOfTime(a);
  const y = minutesOfTime(b);
  if (x === null || y === null) return clockKey(a) === clockKey(b);
  return Math.abs(x - y) < VISIT_GAP_MINUTES;
}

// A work day is a full day on site, so anything else on that date blocks it.
// No assignee means nobody to double-book (the per-day cap covers the business).
export async function findJobConflict(
  staffId: string | null | undefined,
  date: string,
  excludeId?: string,
): Promise<Commitment | null> {
  if (!staffId) return null;
  return (await contractorCommitments(staffId, date, excludeId))[0] ?? null;
}

// A visit clashes with another starting within VISIT_GAP_MINUTES, or any work day.
export async function findVisitConflict(
  staffId: string | null | undefined,
  date: string,
  time: string,
  excludeId?: string,
): Promise<Commitment | null> {
  const busy = await contractorCommitments(staffId ?? null, date, excludeId);
  return busy.find((c) => c.kind === "job" || tooClose(c.time, time)) ?? null;
}

// Staff-facing only: names the other customer. Never show to the public.
export function conflictMessage(c: Commitment): string {
  const when = c.time ? ` at ${c.time}` : "";
  return c.kind === "job"
    ? `That crew is already booked on ${c.name}'s job that day${when}. Pick another day, or assign this to someone else first.`
    : `That crew has a quote visit with ${c.name}${when}, and visits need an hour between them. Pick another time, or assign this to someone else first.`;
}

// One contractor's working window; bad or missing values fall back to the default.
export async function getWorkHours(staffId: string | null | undefined): Promise<WorkHours> {
  if (!staffId || !UUID_RE.test(staffId)) return DEFAULT_WORK_HOURS;
  const res = await pgAdmin(`staff?id=eq.${staffId}&select=work_start_hour,work_end_hour,work_days&limit=1`);
  // On a failed read everyone gets the default window.
  if (!res.ok) {
    console.error("[getWorkHours] failed", { staffId, status: res.status });
    return DEFAULT_WORK_HOURS;
  }
  const rows = (await res.json()) as Parameters<typeof readWorkHours>[0][];
  return readWorkHours(rows[0]);
}

/**
 * A contractor's day as seen by someone booking a visit. Times only, never
 * names: the endpoint is public (staff use findVisitConflict).
 *
 *   slots     start times offered that day, from their hours
 *   taken     those within an hour of something booked
 *   wholeDay  on a pour; nothing bookable
 *   works     false if they don't work that weekday
 */
export async function visitAvailability(
  staffId: string | null | undefined,
  date: string,
): Promise<{ slots: string[]; taken: string[]; wholeDay: boolean; works: boolean }> {
  const hours = await getWorkHours(staffId);
  const slots = slotsFor(hours);
  if (!ISO_DATE.test(date)) return { slots, taken: [], wholeDay: false, works: true };
  if (!worksOn(hours, date)) return { slots, taken: slots, wholeDay: false, works: false };

  const busy = await contractorCommitments(staffId ?? null, date);
  if (busy.some((c) => c.kind === "job")) return { slots, taken: slots, wholeDay: true, works: true };

  const taken = slots.filter((s) => busy.some((c) => tooClose(c.time, s)));
  return { slots, taken, wholeDay: false, works: true };
}

// Service-role, for token-gated code with no session.
export async function getStaffPhoneById(id: string): Promise<string | null> {
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) return null;
  const res = await pgAdmin(`staff?id=eq.${id}&select=phone&limit=1`);
  if (!res.ok) return null;
  const rows = (await res.json()) as { phone: string | null }[];
  return rows[0]?.phone ?? null;
}

// ── Owner settings (app_integrations, provider='settings') ──────────────────
// Holds the primary contractor new quotes fall back to.
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

// ── Routing a lead to the right contractor ──────────────────────────────────
// A lead goes to the first active contractor whose service_types include its
// service, else the primary contractor. `service` is free text (the CRM form
// and endpoint accept anything), so matching ignores case and spaces.
const normalizeService = (s?: string | null) => (s ?? "").trim().toLowerCase();

export async function listActiveContractors(): Promise<Staff[]> {
  const res = await pgAdmin("staff?role=eq.contractor&active=eq.true&select=*&order=created_at.asc");
  if (!res.ok) return [];
  return (await res.json()) as Staff[];
}

// null only when there's no primary contractor either; the lead stays
// unassigned and the owner still gets the alert.
export async function resolveAssignee(service?: string | null): Promise<string | null> {
  const wanted = normalizeService(service);

  if (wanted) {
    // created_at order: the longer-standing contractor wins ties, predictably.
    const contractors = await listActiveContractors();
    const match = contractors.find((c) =>
      (c.service_types ?? []).some((t) => normalizeService(t) === wanted),
    );
    if (match) return match.id;
  }

  return getPrimaryContractorId();
}

// Service-role (no session), for the public submission endpoint.
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
    `quote_requests?status=eq.scheduled&scheduled_date=eq.${date}&reminder_sent_at=is.null&archived_at=is.null&select=*`,
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
// Booked jobs on `date`. Which stages went out is in crew_reminders, checked by
// the caller.
export async function listJobsOn(date: string): Promise<Quote[]> {
  if (!ISO_DATE.test(date)) return [];
  const res = await pgAdmin(`quote_requests?status=eq.scheduled&scheduled_date=eq.${date}&archived_at=is.null&select=*`);
  if (!res.ok) return [];
  return (await res.json()) as Quote[];
}

// Reset so a new or moved date gets its own full run of crew reminders. Best-effort.
export async function clearCrewReminders(id: string): Promise<void> {
  await pgAdmin(`quote_requests?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ crew_reminders: null }),
  }).catch(() => {});
}

// Record a reminder stage ("3", "1", "0"). An array, so adding a stage needs no
// migration. Re-confirming a date clears it.
export async function markCrewReminded(quote: Quote, stage: string): Promise<void> {
  const already = quote.crew_reminders ?? [];
  if (already.includes(stage)) return;
  await pgAdmin(`quote_requests?id=eq.${encodeURIComponent(quote.id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ crew_reminders: [...already, stage] }),
  }).catch(() => {});
}

// Reminders never chase anything older than this: stale leads are a pipeline
// cleanup, not a crew text, and old quotes shouldn't suddenly be "waiting". It
// also stops the first run after deploy texting every historical row.
export const REMINDER_MAX_AGE_DAYS = 14;

function ageWindow(column: string, hours: number): string {
  const newest = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const oldest = new Date(Date.now() - REMINDER_MAX_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  return `&${column}=lt.${encodeURIComponent(newest)}&${column}=gt.${encodeURIComponent(oldest)}`;
}

// A lead with a confirmed visit ahead isn't being ignored: the price waits for
// the visit. After it, they get VISIT_GRACE_DAYS (a visit on the 10th holds the
// lead through the 12th).
export function hasUpcomingVisit(q: Quote, graceFrom = ymdInDays(-VISIT_GRACE_DAYS)): boolean {
  const booked = visitDateOf(q);
  return Boolean(booked && booked >= graceFrom);
}

// ── Stale-lead nudge (cron) ──────────────────────────────────────────────────
// "new" leads older than `hours` (within the window above) with no upcoming
// visit. Status stays "new" until a price is sent.
export async function listStaleLeads(hours: number): Promise<Quote[]> {
  const res = await pgAdmin(
    `quote_requests?status=eq.new${ageWindow("created_at", hours)}` +
      `&stale_lead_reminded_at=is.null&archived_at=is.null&select=*`,
  );
  if (!res.ok) return [];
  // Filtered in JS so visitDateOf stays the single definition of a booked visit.
  return ((await res.json()) as Quote[]).filter((q) => !hasUpcomingVisit(q));
}

export async function markStaleLeadReminded(id: string): Promise<void> {
  await pgAdmin(`quote_requests?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ stale_lead_reminded_at: new Date().toISOString() }),
  });
}

// ── Quote-visit night-before reminders (cron) ───────────────────────────────
// Confirmed in-person visits on `date` (an online row's fallback slot never
// counts). Lost leads excluded: the visit isn't happening.
export async function listVisitsOn(date: string): Promise<Quote[]> {
  if (!ISO_DATE.test(date)) return [];
  const res = await pgAdmin(
    `quote_requests?quote_type=eq.inperson&visit_date=eq.${date}` +
      `&status=neq.lost&archived_at=is.null&select=*`,
  );
  if (!res.ok) return [];
  return (await res.json()) as Quote[];
}

export async function markVisitReminderSent(id: string): Promise<void> {
  await pgAdmin(`quote_requests?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ visit_reminder_sent_at: new Date().toISOString() }),
  });
}

export async function markVisitCrewReminded(id: string): Promise<void> {
  await pgAdmin(`quote_requests?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ visit_crew_reminded_at: new Date().toISOString() }),
  });
}

// ── 48h no-response follow-up (cron) ────────────────────────────────────────
// Sent quotes unanswered for `hours` (within the window above), not yet followed up.
export async function listUnansweredQuotes(hours: number): Promise<Quote[]> {
  const res = await pgAdmin(
    `quote_requests?status=eq.quoted${ageWindow("quote_sent_at", hours)}` +
      `&customer_response=is.null&quote_followup_sent_at=is.null&archived_at=is.null&select=*`,
  );
  if (!res.ok) return [];
  return (await res.json()) as Quote[];
}

export async function markQuoteFollowupSent(id: string): Promise<void> {
  await pgAdmin(`quote_requests?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ quote_followup_sent_at: new Date().toISOString() }),
  });
}

// Activity-log entry from server-only processes (no session).
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

  // Confirmation is a flag (timestamp) on a Scheduled job, not a pipeline stage.
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

// Has this quote's offer run out? Only while the customer still has to decide:
// once answered, the page is their record of the job and never expires. A null
// quote_expires_at never expires.
export function isQuoteExpired(q: Pick<Quote, "quote_expires_at" | "customer_response">): boolean {
  if (q.customer_response) return false;
  if (!q.quote_expires_at) return false;
  return new Date(q.quote_expires_at).getTime() < Date.now();
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

// Customer accepts (with preferred dates, optionally the $150 credit) or
// declines from the quote page. Service role; token-gated.
export type OptionChoice = "accepted" | "declined";

export type CustomerResponseResult = {
  ok: boolean;
  error?: string;
  // The answer was already on file and nothing was written; the caller skips
  // the texts so nobody hears about the same job twice.
  duplicate?: boolean;
  // What they said yes and no to, in page order, for the owner and crew texts.
  accepted?: QuoteOption[];
  declined?: QuoteOption[];
  // The package they picked, if a choice was offered; else null. The crew needs
  // it: "approved" doesn't say what to load the truck with.
  package?: QuotePackage | null;
};

/**
 * A quote the customer declined and the office has since reopened by moving
 * the job off Lost. Read as unanswered everywhere the customer is: their page
 * shows the quote again and their Approve goes through. The next save or send
 * from the CRM clears the old answer for good (saveQuote).
 */
export function isOpenAgain(q: Pick<Quote, "customer_response" | "status">): boolean {
  return q.customer_response === "declined" && q.status !== "lost";
}

/**
 * Forget the customer's per-item answers on a quote that is being reopened.
 * A decline stamps every line item and option "declined"; left in place, the
 * reopened quote would carry answers to an offer that has been put back on
 * the table. The caller has already checked the reader may edit this quote.
 */
export async function clearQuoteResponses(quoteId: string): Promise<void> {
  const body = JSON.stringify({ customer_response: null, responded_at: null });
  const q = `quote_id=eq.${encodeURIComponent(quoteId)}`;
  await Promise.all([
    pgAdmin(`quote_options?${q}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body }),
    pgAdmin(`quote_packages?${q}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body }),
  ]);
}

export async function recordCustomerResponse(
  token: string,
  input: {
    action: "accept" | "decline";
    discount?: boolean;
    preferredDates?: string[];
    // Start time per preferred date, index-aligned. Invalid entries become null
    // and the crew card uses its default.
    preferredTimes?: (string | null)[];
    // Per optional line item, keyed by option id. Required if the quote has items.
    options?: Record<string, OptionChoice>;
    // Package id. Required if a choice is offered; no default, since picking one
    // would pick their price.
    packageId?: string;
  },
): Promise<CustomerResponseResult> {
  if (!/^[a-f0-9]{16,40}$/i.test(token)) return { ok: false, error: "Invalid link." };
  const res = await pgAdmin(
    `quote_requests?public_token=eq.${token}` +
      `&select=id,quote_amount,customer_response,discount_accepted,quote_expires_at,status&limit=1`,
  );
  if (!res.ok) return { ok: false, error: "Could not load your quote." };
  const rows = (await res.json()) as Pick<
    Quote,
    "id" | "quote_amount" | "customer_response" | "discount_accepted" | "quote_expires_at" | "status"
  >[];
  const q = rows[0];
  if (!q) return { ok: false, error: "Quote not found." };

  // Also checked here: a tab opened before expiry can still POST.
  if (isQuoteExpired(q)) {
    return { ok: false, error: "This quote has expired. Please call us and we'll send you an updated one." };
  }

  // ── Already answered ──
  // Double tap, retry or two tabs. The same answer is reported as success with
  // nothing written; re-running would recompute an itemised total and undo the
  // $150 credit. A different answer is refused, so a stale tab can't flip a
  // booked job. A decline on a job moved off Lost is no longer an answer (isOpenAgain).
  const openAgain = isOpenAgain(q);
  const already = openAgain ? null : q.customer_response;
  if (already) return repeatAnswer(already, input.action);

  const [options, packages] = await Promise.all([
    listQuoteOptionsAdmin(q.id),
    listQuotePackagesAdmin(q.id),
  ]);
  const patch: Partial<Quote> = { customer_responded_at: new Date().toISOString() };
  let accepted: QuoteOption[] = [];
  let declined: QuoteOption[] = [];
  // Null unless the quote offered a choice.
  let chosenPackage: QuotePackage | null = null;
  let eventType: string;

  if (input.action === "decline") {
    patch.customer_response = "declined";
    patch.status = "lost";
    declined = options;
    eventType = "customer_declined";
  } else {
    // Approving doesn't book a day: the customer proposes dates and the job
    // stays "approved" until the crew confirms one. Both sides are Raleigh
    // calendar dates, so this is a plain string comparison.
    const min = ymdInDays(LEAD_TIME_DAYS);
    const seen = new Set<string>();
    const dates: string[] = [];
    // Index-aligned with `dates`, so a rejected day doesn't shift later times.
    const times: (string | null)[] = [];
    const rawTimes = input.preferredTimes ?? [];
    for (const [i, raw] of (input.preferredDates ?? []).entries()) {
      const date = String(raw).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || seen.has(date)) continue;
      if (date < min) continue;
      seen.add(date);
      dates.push(date);
      // Shape-checked so a tampered form can't put arbitrary text in the crew's message.
      const t = typeof rawTimes[i] === "string" ? (rawTimes[i] as string).trim().toUpperCase().replace(/\s+/, " ") : "";
      times.push(t && TIME_RE.test(t) ? t : null);
      if (dates.length >= MAX_PREFERRED_DATES) break;
    }
    if (dates.length === 0) {
      return { ok: false, error: `Please pick at least one date ${LEAD_TIME_DAYS} days from now or later.` };
    }

    // Exactly one, and from this quote: another quote's package id would set this price.
    if (isChoice(packages)) {
      chosenPackage = packages.find((p) => p.id === input.packageId) ?? null;
      if (!chosenPackage) {
        return { ok: false, error: "Please choose one of the options before approving." };
      }
    }

    // Every optional item needs an answer: a blank isn't a no, and billing from
    // silence starts disputes.
    if (options.length > 0) {
      const answers = input.options ?? {};
      const unanswered = options.filter((o) => !o.required && !answers[o.id]);
      if (unanswered.length > 0) {
        return { ok: false, error: "Please answer yes or no to each option before approving." };
      }
      accepted = options.filter((o) => o.required || answers[o.id] === "accepted");
      declined = options.filter((o) => !o.required && answers[o.id] === "declined");
      // Only refused when nothing else is bought; with a package, no add-ons is normal.
      if (accepted.length === 0 && !chosenPackage) {
        return {
          ok: false,
          error: "You've said no to everything. Use Decline below if you don't want any of it.",
        };
      }
    }

    // The price follows the answers: chosen package plus accepted items.
    // Downstream readers keep using quote_amount.
    if (options.length > 0 || chosenPackage) {
      patch.quote_amount =
        Math.round((optionAmount(chosenPackage ?? { amount: 0 }) + optionsTotal(accepted)) * 100) / 100;
    }

    patch.customer_response = "accepted";
    patch.status = "approved";
    patch.preferred_dates = dates;
    // Written even if all null, so it always aligns with preferred_dates.
    patch.preferred_times = times;
    if (input.discount && !q.discount_accepted) {
      patch.discount_accepted = true;
      // Off what they actually bought, not the all-in figure.
      const base = patch.quote_amount ?? q.quote_amount;
      if (base != null) {
        patch.quote_amount = Math.max(0, Math.round((Number(base) - DECLINE_CREDIT) * 100) / 100);
      }
    }
    eventType = "customer_accepted";
  }

  // Conditional on the row still being unanswered. Of two racing submissions the
  // second matches nothing and is answered from what the first wrote.
  const savePatch = (body: Partial<Quote>) =>
    pgAdmin(`quote_requests?id=eq.${q.id}${unansweredFilter(openAgain)}&select=id`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(body),
    });

  const upd = await savePatch(patch);
  if (!upd.ok) return { ok: false, error: "Could not save your response. Please call us." };
  const written = (await upd.json().catch(() => [])) as unknown[];
  if (written.length === 0) {
    const again = await pgAdmin(`quote_requests?id=eq.${q.id}&select=customer_response,status&limit=1`);
    const now = again.ok
      ? ((await again.json()) as Pick<Quote, "customer_response" | "status">[])[0]
      : undefined;
    const answered = now && !isOpenAgain(now) ? now.customer_response : null;
    if (answered) return repeatAnswer(answered, input.action);
    return { ok: false, error: "Could not save your response. Please call us." };
  }

  // Stamp each line item's answer so the record survives later edits. After the
  // quote row on purpose: the decision is saved even if this fails.
  const stamp = new Date().toISOString();
  for (const [response, rows] of [
    ["accepted", accepted],
    ["declined", declined],
  ] as const) {
    if (rows.length === 0) continue;
    await pgAdmin(`quote_options?id=in.(${rows.map((o) => o.id).join(",")})`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ customer_response: response, responded_at: stamp }),
    }).catch(() => {});
  }

  // Likewise for packages: chosen accepted, others declined, so it stays visible
  // that a choice was offered.
  if (isChoice(packages)) {
    for (const [response, rows] of [
      ["accepted", chosenPackage ? [chosenPackage] : []],
      ["declined", packages.filter((p) => p.id !== chosenPackage?.id)],
    ] as const) {
      if (rows.length === 0) continue;
      await pgAdmin(`quote_packages?id=in.(${rows.map((p) => p.id).join(",")})`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ customer_response: response, responded_at: stamp }),
      }).catch(() => {});
    }
  }

  await pgAdmin("quote_events", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      quote_id: q.id,
      type: eventType,
      meta: {
        discount: Boolean(input.discount),
        preferred_dates: patch.preferred_dates ?? null,
        preferred_times: patch.preferred_times ?? null,
        chosen_package: chosenPackage?.title ?? null,
        accepted_options: accepted.map((o) => o.title),
        declined_options: declined.map((o) => o.title),
        total: patch.quote_amount ?? null,
      },
    }),
  });
  return { ok: true, accepted, declined, package: chosenPackage };
}

// ── The customer said yes on the phone ──────────────────────────────────────
// Separate from recordCustomerResponse on purpose: that one is the customer's
// own tap (token, service role, expiry check). This is staff recording a call,
// so it runs as them (pgUser) and RLS keeps contractors to their own jobs.
// It writes the same customer_response/status everything else reads; only the
// event differs, recording who entered it and that it came by phone.
export async function recordOfflineAcceptance(
  session: Session,
  id: string,
  input: {
    // Per optional line item, keyed by option id. Same rule as the customer
    // path: silence is not consent to bill.
    options?: Record<string, OptionChoice>;
    // Package id, required if a choice is offered. No default.
    packageId?: string;
    // Day/time agreed on the call, recorded as their preference; booking is
    // confirmSchedule's job.
    agreedDate?: string | null;
    agreedTime?: string | null;
  },
): Promise<{
  ok: boolean;
  error?: string;
  accepted?: QuoteOption[];
  declined?: QuoteOption[];
  package?: QuotePackage | null;
}> {
  const q = await getQuote(session, id);
  if (!q) return { ok: false, error: "You don't have access to this quote." };

  // Already answered or closed out (offlineAcceptanceRefusal).
  const refusal = offlineAcceptanceRefusal(q);
  if (refusal) return { ok: false, error: refusal };
  if (q.quote_amount == null || Number(q.quote_amount) <= 0) {
    return { ok: false, error: "Put a price on this quote before recording an approval." };
  }
  // Expiry deliberately not checked: they just agreed to a price staff can see.

  const [options, packages] = await Promise.all([
    listQuoteOptions(session, id),
    listQuotePackages(session, id),
  ]);
  const patch: Partial<Quote> = {
    customer_response: "accepted",
    customer_responded_at: new Date().toISOString(),
    status: "approved",
  };
  let accepted: QuoteOption[] = [];
  let declined: QuoteOption[] = [];
  let chosenPackage: QuotePackage | null = null;

  if (isChoice(packages)) {
    chosenPackage = packages.find((p) => p.id === input.packageId) ?? null;
    if (!chosenPackage) {
      return { ok: false, error: "Say which option they went with before recording the approval." };
    }
  }

  if (options.length > 0) {
    const answers = input.options ?? {};
    const unanswered = options.filter((o) => !o.required && !answers[o.id]);
    if (unanswered.length > 0) {
      return { ok: false, error: "Mark each optional line yes or no before recording the approval." };
    }
    accepted = options.filter((o) => o.required || answers[o.id] === "accepted");
    declined = options.filter((o) => !o.required && answers[o.id] === "declined");
    // With a package chosen, no to every add-on is ordinary.
    if (accepted.length === 0 && !chosenPackage) {
      return { ok: false, error: "They said no to every line. That's a declined quote, not an approved one." };
    }
  }

  // Price follows the answers, as on the customer path.
  if (options.length > 0 || chosenPackage) {
    patch.quote_amount =
      Math.round((optionAmount(chosenPackage ?? { amount: 0 }) + optionsTotal(accepted)) * 100) / 100;
  }

  // The lead-time floor deliberately doesn't apply: it stops customers
  // committing a crew unchecked, and the person entering this is the crew.
  if (input.agreedDate && ISO_DATE.test(input.agreedDate)) {
    patch.preferred_dates = [input.agreedDate];
    const time = (input.agreedTime ?? "").trim().toUpperCase().replace(/\s+/, " ");
    patch.preferred_times = [time && TIME_RE.test(time) ? time : null];
  }

  // Conditional on no answer on file, so two people (or the customer's own tap)
  // can't both write. Zero rows: someone got there first, or RLS hid it.
  const save = async (body: Partial<Quote>): Promise<{ rows: number } | { error: string }> => {
    const res = await pgUser(
      `quote_requests?id=eq.${encodeURIComponent(id)}&customer_response=is.null&select=id`,
      session.accessToken,
      { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(body) },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[offline-acceptance] failed", { id, status: res.status, body: text });
      return { error: `Could not save (error ${res.status}). Please try again or call the office.` };
    }
    return { rows: ((await res.json().catch(() => [])) as unknown[]).length };
  };

  const saved = await save(patch);
  if ("error" in saved) return { ok: false, error: saved.error };
  if (saved.rows === 0) {
    const now = await getQuote(session, id);
    return {
      ok: false,
      error:
        (now && offlineAcceptanceRefusal(now)) ??
        "You can't change this job. It may have been reassigned to someone else.",
    };
  }

  // Stamp line items after the quote row, best-effort, as on the customer path.
  const stamp = new Date().toISOString();
  for (const [response, rows] of [
    ["accepted", accepted],
    ["declined", declined],
  ] as const) {
    if (rows.length === 0) continue;
    await pgUser(`quote_options?id=in.(${rows.map((o) => o.id).join(",")})`, session.accessToken, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ customer_response: response, responded_at: stamp }),
    }).catch(() => {});
  }
  if (isChoice(packages)) {
    for (const [response, rows] of [
      ["accepted", chosenPackage ? [chosenPackage] : []],
      ["declined", packages.filter((p) => p.id !== chosenPackage?.id)],
    ] as const) {
      if (rows.length === 0) continue;
      await pgUser(`quote_packages?id=in.(${rows.map((p) => p.id).join(",")})`, session.accessToken, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ customer_response: response, responded_at: stamp }),
      }).catch(() => {});
    }
  }

  return { ok: true, accepted, declined, package: chosenPackage };
}


// ── Change orders ───────────────────────────────────────────────────────────
// A price change on an agreed (usually booked) job is a small quote of its own:
// the price only moves when the customer says yes. Sent, withdrawn, answered.
//
// Money needs nothing special: the ledger is "current total minus collected"
// (readLedger in fees.ts) and the office cut is re-derived from the frozen rate,
// so a $4,125 deposit on an $8,250 job that becomes $9,400 leaves $5,275 owed.

// One object so every path that ends a change clears every change column; a
// half-cleared change leaves the customer page waiting forever.
const CLEAR_CHANGE: Partial<Quote> = {
  change_note: null,
  change_amount: null,
  change_requested_at: null,
  change_requested_by: null,
  change_lines: null,
  change_deposit_cents: null,
};

export type ChangeRequestResult = { ok: boolean; error?: string; quote?: Quote };

/**
 * Send a change for the customer to approve. Runs as the user, so RLS keeps a
 * contractor to their own jobs (the crew take these calls).
 */
export async function requestChange(
  session: Session,
  id: string,
  input: { note: string; newAmount: number; lines?: QuoteOptionDraft[]; depositCents?: number | null; paidCents?: number },
): Promise<ChangeRequestResult> {
  const current = await getQuote(session, id);
  if (!current) return { ok: false, error: "You don't have access to this job." };

  // Only on an accepted job. Before that the quote itself is editable, and a
  // "change" would put two offers in front of the customer.
  if (current.customer_response !== "accepted" || current.status === "lost") {
    return { ok: false, error: "This job isn't approved yet. Change the quote itself instead." };
  }
  // Closed-out work is an invoice dispute for the office, not a change order.
  if (current.status === "completed" || current.status === "paid") {
    return { ok: false, error: "This job is already closed out. Give the office a call to sort out the price." };
  }
  if (current.change_requested_at) {
    return { ok: false, error: "There's already a change waiting on the customer. Withdraw it first." };
  }

  const note = noEmDash(input.note.trim()).slice(0, CHANGE_NOTE_MAX);
  if (note.length < 3) return { ok: false, error: "Say what's changing, so the customer knows what they're approving." };

  // When lines are given they ARE the price: the total is their sum, so the
  // customer never sees lines that add up to something else.
  const lines = (input.lines ?? []).map((l) => ({
    title: l.title,
    description: l.description || null,
    amount: l.amount,
  }));
  const [existing, packages] = await Promise.all([listQuoteOptions(session, id), listQuotePackages(session, id)]);
  // A package job's price sits outside the line items, so a breakdown couldn't
  // add up. Rare; change it as one figure.
  if (lines.length > 0 && packages.length > 0) {
    return { ok: false, error: "This job was priced as a choice of options, so change the total as one figure." };
  }
  // Change lines replace the job's lines on approval. A job that already has
  // lines always gets a list (even empty), or old lines would sit under a new
  // total. Package jobs keep their extras untouched; only the figure moves.
  const changeLines = packages.length > 0 ? null : lines.length > 0 || existing.length > 0 ? lines : null;

  const amount =
    lines.length > 0 ? optionsTotal(lines) : Math.round(Number(input.newAmount) * 100) / 100;
  if (!Number.isFinite(amount) || amount < 0 || amount > 99_999_999) {
    return { ok: false, error: "Enter a valid new total for the job." };
  }
  // Same total is fine when the breakdown changes. Compared with where the
  // crew's breakdown started (changeStartLines), so a one-price job's own
  // "as approved" line isn't a change.
  const linesChanged =
    changeLines !== null &&
    !sameChangeLines(changeLines, changeStartLines(boughtLines(existing), current.quote_amount, current.service));
  if (toCents(amount) === toCents(current.quote_amount) && !linesChanged) {
    return { ok: false, error: "That's the same total they already agreed to. Change the figure, or just call them." };
  }

  // Optional second deposit: whole cents, at least $1, and no more than the
  // balance after the change.
  let deposit: number | null = null;
  if (input.depositCents != null) {
    deposit = Math.round(Number(input.depositCents));
    const balance = toCents(amount) - Math.max(0, input.paidCents ?? 0);
    if (!Number.isFinite(deposit) || deposit < 100) {
      return { ok: false, error: "Enter how much they need to send up front, or untick the deposit." };
    }
    if (deposit > balance) {
      return { ok: false, error: "The deposit can't be more than what they'll owe after this change." };
    }
  }

  const changePatch: Partial<Quote> = {
    change_note: note,
    change_amount: amount,
    change_requested_at: new Date().toISOString(),
    change_requested_by: session.staff.id,
    change_lines: changeLines,
    change_deposit_cents: deposit,
  };
  // Against the computed total, lines and all: a contractor's change may only raise it.
  const refusal = jobPatchRefusal(session.staff.role, current, changePatch, session.staff.id);
  if (refusal) return { ok: false, error: refusal };

  const { quote, error } = await updateQuoteResult(session, id, changePatch);
  if (!quote) {
    return {
      ok: false,
      error: error ?? "Could not send that change. Please try again or call the office.",
    };
  }
  return { ok: true, quote };
}

/**
 * Withdraw a change before the customer answers. The price never moved, so
 * clearing the change columns is all there is to undo.
 */
export async function cancelChange(session: Session, id: string): Promise<ChangeRequestResult> {
  const current = await getQuote(session, id);
  if (!current) return { ok: false, error: "You don't have access to this job." };
  if (!current.change_requested_at) return { ok: false, error: "There's no change waiting on this job." };

  const { quote, error } = await updateQuoteResult(session, id, CLEAR_CHANGE);
  if (!quote) return { ok: false, error: error ?? "Could not withdraw that change." };
  return { ok: true, quote };
}

export type ChangeResponseResult = {
  ok: boolean;
  error?: string;
  /** Nothing was written because their answer was already on file. */
  duplicate?: boolean;
  quote?: Quote;
  /** What the job was worth before, and what it is worth now. */
  from?: number | null;
  to?: number | null;
  note?: string | null;
  /** The second deposit the approved change asked for, in cents, if any. */
  depositCents?: number | null;
  /** The change on the job is not the one the customer's page showed. Nothing was written. */
  stale?: boolean;
};

const STALE_CHANGE_ERROR ="This change was updated, please reload the page.";

/**
 * The customer's answer from their quote link. Service role: no session, the
 * token authorises it. Accepting only sets quote_amount; balance, office cut,
 * payment page and existing deposits all re-derive from it.
 */
export async function recordChangeResponse(
  token: string,
  action: "accept" | "decline",
  /** The change_requested_at the customer's page displayed; null if it showed none. */
  shownRequestedAt: string | null = null,
): Promise<ChangeResponseResult> {
  if (!/^[a-f0-9]{16,40}$/i.test(token)) return { ok: false, error: "Invalid link." };

  const q = await getQuoteByToken("public_token", token);
  if (!q) return { ok: false, error: "Quote not found." };

  // Nothing waiting: usually a second tap or a change withdrawn while the tab
  // was open. Success, because there's nothing left for them to do.
  if (!q.change_requested_at || q.change_amount == null) return { ok: true, duplicate: true };

  return applyChange(q.id, action === "accept", {}, shownRequestedAt);
}

/**
 * Apply a change the customer agreed to by phone or on site. Same transaction
 * and log row as their own tap, plus `recorded_by`. requestChange has already
 * checked access and figures.
 */
export async function recordChangeAgreed(
  session: Session,
  id: string,
): Promise<ChangeResponseResult> {
  // Owner only, rechecked because applyChange runs with the service role.
  const refusal = changeOrderRefusal(session.staff.role, { agreed: true });
  if (refusal) return { ok: false, error: refusal };
  const by = session.staff.full_name || session.staff.email || "Staff";
  return applyChange(id, true, { recorded_by: by });
}

async function applyChange(
  quoteId: string,
  accept: boolean,
  extraMeta: Record<string, unknown> = {},
  shownRequestedAt: string | null = null,
): Promise<ChangeResponseResult> {
  const action = accept ? "accept" : "decline";

  // Price, breakdown and cleared change in one transaction, so a failed second
  // write can't leave new lines against an old total. The page's
  // change_requested_at is checked under the row lock. Paid state is
  // resyncJobPaidState's call, made by the caller afterwards (both directions).
  const call = (args: Record<string, unknown>) =>
    pgAdmin("rpc/apply_change_response", { method: "POST", body: JSON.stringify(args) });
  const args = { p_id: quoteId, p_accept: accept };
  const res = shownRequestedAt ? await call({ ...args, p_requested_at: shownRequestedAt }) : await call(args);
  if (!res.ok) return { ok: false, error: "Could not save your answer. Please call us." };
  const out = (await res.json()) as {
    status: "ok" | "none" | "stale";
    quote?: Quote;
    from?: number | null;
    to?: number | null;
    note?: string | null;
    old_lines?: unknown;
    new_lines?: unknown;
    deposit_cents?: number | null;
  };
  if (out.status === "stale") return { ok: false, stale: true, error: STALE_CHANGE_ERROR };
  // Answered in another tab between the read and the lock.
  if (out.status !== "ok" || !out.quote) return { ok: true, duplicate: true };

  const from = out.from ?? null;
  const to = out.to == null ? null : Number(out.to);
  const note = out.note ?? null;

  await pgAdmin("quote_events", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      quote_id: quoteId,
      type: action === "accept" ? "change_accepted" : "change_declined",
      // Breakdown before and after, so the log shows what the job used to include.
      meta: {
        from,
        to,
        note,
        ...(out.new_lines != null ? { lines_before: out.old_lines, lines_after: out.new_lines } : {}),
        ...(out.deposit_cents != null ? { deposit_cents: out.deposit_cents } : {}),
        ...extraMeta,
      },
    }),
  }).catch(() => {});

  return { ok: true, quote: out.quote, from, to, note, depositCents: out.deposit_cents ?? null };
}

// Confirm (or move) the work day. Runs as the user, so RLS lets the assigned
// crew book their own jobs. Returns the previous date/time so the caller can
// tell a first booking from a reschedule.
export async function confirmSchedule(
  session: Session,
  id: string,
  date: string,
  time: string,
): Promise<{ ok: boolean; error?: string; previous?: string | null; previousTime?: string | null; unchanged?: boolean }> {
  if (!ISO_DATE.test(date)) return { ok: false, error: "Pick a valid date." };
  // e.g. "9:00 AM"; shape-checked so a tampered form can't inject text into SMS.
  if (!TIME_RE.test(time.trim())) return { ok: false, error: "Pick a start time." };
  const cleanTime = time.trim().toUpperCase().replace(/\s+/, " ");

  const current = await getQuote(session, id);
  if (!current) return { ok: false, error: "You don't have access to this job." };
  // A new time on the same day is still a change the customer must hear about.
  if (current.scheduled_date === date && current.scheduled_time === cleanTime) {
    return { ok: true, previous: date, previousTime: cleanTime, unchanged: true };
  }

  // One job per day; the DB enforces it too, but this gives a clear message.
  if ((await countJobsOn(date, id)) >= MAX_JOBS_PER_DAY) {
    return { ok: false, error: "Another job is already booked that day." };
  }

  // ...and one place at a time for the crew, e.g. a quote visit that day.
  const clash = await findJobConflict(current.assigned_to, date, id);
  if (clash) return { ok: false, error: conflictMessage(clash) };

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

  // Separate best-effort write: booking must not fail on the reminder column.
  await clearCrewReminders(id);

  return { ok: true, previous: current.scheduled_date, previousTime: current.scheduled_time };
}

// ── Quote visits (the in-person/online appointment, not the work day) ───────
// Separate from confirmSchedule: visits can share a day and moving one never
// touches pipeline status.
export async function rescheduleVisit(
  session: Session,
  id: string,
  date: string,
  time: string,
): Promise<{ ok: boolean; error?: string; previous?: string | null; previousTime?: string | null; unchanged?: boolean }> {
  if (!ISO_DATE.test(date)) return { ok: false, error: "Pick a valid date." };
  const cleanTime = time.trim().toUpperCase().replace(/\s+/, " ");
  if (cleanTime && !TIME_RE.test(cleanTime)) return { ok: false, error: "Pick a valid time." };

  const current = await getQuote(session, id);
  if (!current) return { ok: false, error: "You don't have access to this quote." };
  if (current.visit_date === date && (current.visit_time ?? "") === cleanTime) {
    return { ok: true, previous: date, previousTime: cleanTime, unchanged: true };
  }

  // No per-day cap: visits stack an hour apart per person, and a work day blocks all slots.
  const clash = await findVisitConflict(current.assigned_to, date, cleanTime, id);
  if (clash) return { ok: false, error: conflictMessage(clash) };

  const { quote: updated, error } = await updateQuoteResult(session, id, {
    visit_date: date,
    visit_time: cleanTime || null,
    // Re-arm night-before reminders, or a moved visit is never reminded again.
    visit_reminder_sent_at: null,
    visit_crew_reminded_at: null,
  });
  if (!updated) return { ok: false, error: error ?? "Could not move that visit." };

  return { ok: true, previous: current.visit_date, previousTime: current.visit_time };
}

// Take an appointment off the calendar. A booked job drops back to "approved"
// so it resurfaces in the pipeline instead of sitting dateless in "scheduled".
export async function clearAppointment(
  session: Session,
  id: string,
  kind: "job" | "visit",
): Promise<{ ok: boolean; error?: string; previous?: string | null; previousTime?: string | null }> {
  const current = await getQuote(session, id);
  if (!current) return { ok: false, error: "You don't have access to this quote." };

  const patch: Partial<Quote> =
    kind === "job"
      ? {
          scheduled_date: null,
          scheduled_time: null,
          scheduled_by: null,
          scheduled_at: null,
          confirmed_at: null,
          reminder_sent_at: null,
          status: current.status === "scheduled" ? "approved" : current.status,
        }
      : { visit_date: null, visit_time: null, visit_reminder_sent_at: null, visit_crew_reminded_at: null };

  const { quote: updated, error } = await updateQuoteResult(session, id, patch);
  if (!updated) return { ok: false, error: error ?? "Could not remove that appointment." };

  if (kind === "job") await clearCrewReminders(id);

  return {
    ok: true,
    previous: kind === "job" ? current.scheduled_date : current.visit_date,
    previousTime: kind === "job" ? current.scheduled_time : current.visit_time,
  };
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
// The token is a capability (whoever holds it can create one contractor
// account): long, random, single-use, expiring, and every lookup rechecks all three.

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

// Service-role (the onboarding page has no session). null for every unusable
// state alike, so callers can't probe which tokens exist.
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

// Burn the invite. used_at=is.null makes racing submissions lose: an empty
// result means someone else got there first.
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

// Telemetry for the owner; best-effort so it never blocks onboarding.
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
// pgUser so RLS authorizes: owners see all; contractors their own onboarding
// doc and agreements for their assigned jobs.

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

// Best-effort: the row is the source of truth; an orphaned object is harmless.
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
// Service role: written at login, before any session exists.
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

// Consecutive failed sign-ins for this ACCOUNT since its last success. The
// middleware's IP limiter can't see one password list tried from many
// addresses. A success clears the streak. Service role: no session yet.
export async function recentFailuresFor(email: string, windowMs: number): Promise<number> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return 0;
  const since = new Date(Date.now() - windowMs).toISOString();
  const params = new URLSearchParams({
    select: "success,created_at",
    email: `eq.${normalized}`,
    created_at: `gte.${since}`,
    // Lockout refusals aren't attempts; counting them would let repeated
    // clicks during the cool-off extend it forever.
    reason: "neq.locked_out",
    order: "created_at.desc",
    limit: "40",
  });
  const res = await pgAdmin(`login_attempts?${params.toString()}`);
  // Fail open: this is a throttle, not authorization (the password still has to match).
  if (!res.ok) return 0;
  const rows = (await res.json()) as { success: boolean }[];
  let streak = 0;
  for (const row of rows) {
    if (row.success) break;
    streak += 1;
  }
  return streak;
}

// `since` bounds the window so dashboard stats aren't truncated by the row limit.
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
