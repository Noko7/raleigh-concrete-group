import { after, NextResponse } from "next/server";

import { ADDRESS_HINT, isFullAddress } from "@/lib/address";
import { ymdInDays } from "@/lib/crm/clock";
import { TIME_RE, VISIT_LEAD_DAYS } from "@/lib/crm/constants";
import { alertOwner, notifyCustomerReceived, notifyNewQuote } from "@/lib/crm/notify";
import {
  findVisitConflict,
  getStaffContactById,
  resolveAssignee,
  visitAvailability,
} from "@/lib/crm/queries";
import { isValidUsPhone, leadReference, UUID_RE } from "@/lib/quote-submit";
import { clientIp, rateLimit } from "@/lib/rate-limit";

// All quote submissions go through here: validated server-side and inserted
// with the service-role key, while RLS blocks the anon key from the table, so
// customer data can't be scraped or spammed from the client.
//
// THE RULE: a request with a name and a callable phone number is always saved.
// Anything else wrong (unverified address, bad email, a slot that went, an
// unreadable calendar, failed photo uploads) becomes a note at the top of the
// lead's details, and the success screen tells the customer the truth. The
// only refusals: missing name/number, rate limit, or the database refusing the
// row, which texts the owner the full lead.

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
// Prefer the service-role key (bypasses RLS; the table stays locked to the
// public). Anon only if no service key is configured.
const WRITE_KEY = SERVICE_KEY || ANON_KEY;
const CONFIGURED = Boolean(SUPABASE_URL && WRITE_KEY);

const LIMITS = {
  name: 120,
  phone: 32,
  email: 200,
  service: 120,
  address: 300,
  city: 120,
  details: 2000,
  preferred_time: 120,
  source_path: 300,
  files: 12,
  filePath: 300,
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Narrower than constants.ts QUOTE_TYPES: "plans" is a commercial route the
// office opens on a call, not something the public may self-select.
const QUOTE_TYPES = new Set(["online", "inperson"]);

function asString(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

// Shown whenever the request did NOT reach the database. Always with the
// number: "try again" is a dead end if we're what's broken.
const SAVE_FAILED = "We couldn't save your request just now. Please call or text us at (919) 873-3919.";

// Every failure uses this shape, with an explicit `saved: false` so no response
// can be mistaken for a save (see src/lib/quote-submit.ts).
function fail(status: number, error: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, saved: false, error, ...extra }, { status });
}

type InsertResult =
  | { ok: true; id: string | null; publicToken?: string; jobToken?: string }
  | { ok: false; status: number; detail: string };

async function insertLead(row: Record<string, unknown>): Promise<InsertResult> {
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/quote_requests`, {
      method: "POST",
      cache: "no-store",
      headers: {
        apikey: WRITE_KEY,
        Authorization: `Bearer ${WRITE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    // Network failure or the 10s deadline. Status 0 = no answer; the caller retries once.
    return { ok: false, status: 0, detail: e instanceof Error ? e.message : String(e) };
  }
  if (!res.ok) return { ok: false, status: res.status, detail: await res.text().catch(() => "") };
  const created = (await res.json().catch(() => [])) as Array<{ id?: string; job_token?: string; public_token?: string }>;
  const first = Array.isArray(created) ? created[0] : undefined;
  return {
    ok: true,
    id: typeof first?.id === "string" && UUID_RE.test(first.id) ? first.id : null,
    publicToken: first?.public_token,
    jobToken: first?.job_token,
  };
}

// Whether an already-saved row has a visit, so a retry's success screen matches the first.
async function visitBookedFor(id: string): Promise<boolean> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/quote_requests?id=eq.${id}&select=quote_type,visit_date&limit=1`, {
    cache: "no-store",
    headers: { apikey: WRITE_KEY, Authorization: `Bearer ${WRITE_KEY}` },
    signal: AbortSignal.timeout(5_000),
  }).catch(() => null);
  if (!res?.ok) return false;
  const rows = (await res.json().catch(() => [])) as Array<{ quote_type?: string; visit_date?: string | null }>;
  return rows[0]?.quote_type === "inperson" && Boolean(rows[0]?.visit_date);
}

// The row an earlier attempt of this same form already saved, if any.
async function findBySubmissionId(submissionId: string): Promise<string | null> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/quote_requests?client_submission_id=eq.${encodeURIComponent(submissionId)}&select=id&limit=1`,
    {
      cache: "no-store",
      headers: { apikey: WRITE_KEY, Authorization: `Bearer ${WRITE_KEY}` },
      signal: AbortSignal.timeout(8_000),
    },
  ).catch(() => null);
  if (!res?.ok) return null;
  const rows = (await res.json().catch(() => [])) as Array<{ id?: string }>;
  const id = rows[0]?.id;
  return typeof id === "string" && UUID_RE.test(id) ? id : null;
}

// Texts run after the response, so a slow SMS provider can't delay or time out
// the customer's answer (which would make them resubmit a saved lead).
function afterResponse(work: () => Promise<void>) {
  try {
    after(() => work().catch((e) => console.error("[quote] post-save notification failed", e)));
  } catch {
    // Outside a request (a script, a test): nothing to defer to.
    void work().catch((e) => console.error("[quote] post-save notification failed", e));
  }
}

// The database refused the row. If the customer doesn't call, this owner text
// is the only place the lead exists, so it carries everything needed.
function alertUnsaved(why: string, lead: Record<string, unknown>) {
  const line = (label: string, v: unknown) => (typeof v === "string" && v ? `${label}: ${v}` : null);
  const message = [
    "NEW LEAD - NOT SAVED",
    "",
    `The quote form couldn't save this request (${why}). The customer was told to call or text us. Call them:`,
    "",
    line("Name", lead.name),
    line("Phone", lead.phone),
    line("Address", lead.address),
    line("Service", lead.service),
    line("Type", lead.quote_type),
    line("Visit", [lead.visit_date, lead.visit_time].filter(Boolean).join(" ")),
  ]
    .filter((l) => l !== null)
    .join("\n");
  afterResponse(() => alertOwner(message, null, { quoteId: null, kind: "quote_not_saved" }));
}

// Mark the in-progress draft sent, so it leaves the CRM's "started, not sent"
// list and its tab closing doesn't alert anyone. Best effort.
async function markDraftSent(submissionId: string | null, leadId: string) {
  if (!submissionId || !SERVICE_KEY) return;
  await fetch(`${SUPABASE_URL}/rest/v1/quote_drafts?submission_id=eq.${submissionId}`, {
    method: "PATCH",
    cache: "no-store",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ lead_id: leadId, updated_at: new Date().toISOString() }),
    signal: AbortSignal.timeout(5_000),
  })
    .then(async (r) => {
      if (!r.ok) console.error("[quote] could not mark draft sent", r.status, (await r.text().catch(() => "")).slice(0, 200));
    })
    .catch((e) => console.error("[quote] could not mark draft sent", e));
}

// "2026-09-26" + "10:00 AM" -> "Sat Sep 26 at 10:00 AM", for notes on the lead.
function whenLabel(date: string, time: string): string {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })
    : date;
  return [d, time].filter(Boolean).join(" at ") || "no time";
}

export async function POST(request: Request) {
  // Nothing escapes as an unlogged HTML 500: the customer gets our number and
  // the logs get the reason.
  try {
    return await handle(request);
  } catch (e) {
    console.error("[quote] unhandled error - lead NOT saved", e);
    return fail(500, SAVE_FAILED);
  }
}

async function handle(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return fail(400, "Invalid request.");
  }
  if (!body || typeof body !== "object") return fail(400, "Invalid request.");

  // The hidden trap field doesn't discard a request (a real customer lost that
  // way can't be found). A trapped request that passes the checks is saved into
  // Archived, off calendar and pipeline, texting only the owner. It's held to a
  // full street address, which bots rarely produce and autofill always does.
  const trapValue = asString(body.company, 100);
  const trapped = trapValue !== "";

  const ip = clientIp(request);
  // Generous: every refusal is someone told to phone instead.
  if (await rateLimit(`quote:${ip}`, 12, 10 * 60 * 1000)) {
    console.warn("[quote] rate limited", { ip });
    return fail(429, "Too many requests. Please call or text us at (919) 873-3919.");
  }

  // ── Validate ──
  const name = asString(body.name, LIMITS.name);
  const phoneRaw = asString(body.phone, LIMITS.phone);
  const emailRaw = asString(body.email, LIMITS.email);
  const service = asString(body.service, LIMITS.service);
  const address = asString(body.address, LIMITS.address);
  const city = asString(body.city, LIMITS.city);
  const details = asString(body.details, LIMITS.details);
  const quoteTypeRaw = asString(body.quote_type, 16);
  const visitDateRaw = asString(body.visit_date, 10);
  const visitTimeRaw = asString(body.visit_time, 40);
  const sourcePath = asString(body.source_path, LIMITS.source_path);

  // Only what we can't call them back without; everything else is a note (THE RULE).
  const errors: string[] = [];
  if (name.length < 2) errors.push("name");
  if (!isValidUsPhone(phoneRaw)) errors.push("phone");
  if (errors.length) {
    return fail(422, errors.includes("phone") ? "Please enter a 10-digit US phone number." : "Please enter your name.", {
      fields: errors,
    });
  }

  if (trapped && !isFullAddress(address)) {
    console.warn("[quote] spam-trap field filled and no full address - rejected", { ip });
    return fail(422, "Please check your details, or call or text us at (919) 873-3919.", { fields: ["address"] });
  }

  // Notes for the office, at the top of the details, shown on the lead card and
  // in the owner's and crew's texts.
  const notes: string[] = [];

  let email = emailRaw;
  if (email && !EMAIL_RE.test(email)) {
    notes.push(`Email looked mistyped: "${email.slice(0, 80)}"`);
    email = "";
  }
  if (!address) notes.push("No address given - ask for it");
  else if (!isFullAddress(address)) notes.push("Address may be incomplete - confirm it");
  // The pop-up only sends these two; anything else is tampered, but still a
  // person with a phone number.
  const quoteType = QUOTE_TYPES.has(quoteTypeRaw) ? quoteTypeRaw : "";

  // The visit is optional for both types. A chosen slot is kept if it's a real
  // day inside the lead time and a real slot; otherwise it becomes a note.
  let visitDate = "";
  let visitTime = "";
  const askedVisit = Boolean(visitDateRaw || visitTimeRaw);
  if (askedVisit) {
    const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(visitDateRaw) && visitDateRaw >= ymdInDays(VISIT_LEAD_DAYS);
    const timeOk = TIME_RE.test(visitTimeRaw);
    if (dateOk && timeOk) {
      visitDate = visitDateRaw;
      visitTime = visitTimeRaw;
    } else {
      notes.push(`Asked for ${whenLabel(visitDateRaw, visitTimeRaw)}, which isn't a bookable time - call to set one`);
    }
  } else if (quoteType === "inperson") {
    notes.push("No visit time picked - call to set one");
  }

  // file_urls: only paths we created in our own bucket.
  let fileUrls: string[] | null = null;
  if (Array.isArray(body.file_urls)) {
    const cleaned = body.file_urls
      .filter((p): p is string => typeof p === "string")
      .map((p) => p.trim().slice(0, LIMITS.filePath))
      .filter((p) => p.startsWith("quote-uploads/"))
      .slice(0, LIMITS.files);
    fileUrls = cleaned.length ? cleaned : null;
  }
  // An online quote is priced from what's sent, so it needs a photo and a
  // description: the one exception to "never refuse", since without them we
  // can neither price nor reliably reach the lead. The form checks first; this
  // catches anything bypassing it.
  if (quoteType === "online") {
    const missing: string[] = [];
    if (!fileUrls || fileUrls.length === 0) missing.push("photo");
    if (details.trim().length < 10) missing.push("details");
    if (missing.length) {
      return fail(
        422,
        missing.includes("photo")
          ? "Please add at least one photo of the spot so we can price it."
          : "Please tell us a little about the job so we can price it.",
        { fields: missing },
      );
    }
  }

  // Failed photo uploads: the customer is asked to text them, the office to expect them.
  const filesFailed = typeof body.files_failed === "number" && body.files_failed > 0 ? Math.min(Math.floor(body.files_failed), 20) : 0;
  if (filesFailed) {
    notes.push(`${filesFailed} photo${filesFailed === 1 ? "" : "s"} failed to upload - they were asked to text ${filesFailed === 1 ? "it" : "them"}`);
  }

  // One id per filled-in form, constant across retries (quote-submit.ts).
  // Non-UUIDs are ignored.
  const submissionIdRaw = asString(body.submission_id, 64);
  const submissionId = UUID_RE.test(submissionIdRaw) ? submissionIdRaw.toLowerCase() : null;

  if (!CONFIGURED) {
    // No database keys: never report success for a request that went nowhere.
    console.error("[quote] Supabase is not configured - lead NOT saved", { name, phone: phoneRaw });
    alertUnsaved("the site has no database keys", { name, phone: phoneRaw, address, service, quote_type: quoteType });
    return fail(503, SAVE_FAILED);
  }

  // The lead's assignee, used for the slot check, the row and the texts.
  // Trapped requests belong to nobody until restored. These reads may fail, and
  // a failed read must not cost the lead.
  let assignee: string | null = null;
  if (SERVICE_KEY && !trapped) {
    assignee = await resolveAssignee(service).catch((e) => {
      console.error("[quote] could not resolve assignee - saving unassigned", e);
      notes.push("Couldn't auto-assign - assign it by hand");
      return null;
    });
  }

  // Don't put the crew in two places: check the assignee's window and the hour
  // around existing visits. A failing slot doesn't bounce the customer (that
  // drove people away); the request is saved without it, noted, and they're
  // told we'll call. The form greys out taken times, so this is a rare race.
  // The reason stays hidden: this endpoint is public, and "already with Jane
  // Smith at 10am" would leak a customer's name and schedule.
  let visitBooked = quoteType === "inperson" && Boolean(visitDate);
  if (visitBooked && !trapped) {
    const asked = whenLabel(visitDate, visitTime);
    try {
      const { slots, works, wholeDay } = await visitAvailability(assignee, visitDate);
      let why = "";
      if (!works) why = "not a working day";
      else if (wholeDay) why = "a job is booked that day";
      else if (!slots.includes(visitTime)) why = "outside working hours";
      else {
        const clash = await findVisitConflict(assignee, visitDate, visitTime);
        if (clash) why = clash.kind === "job" ? "a job is booked that day" : "that time was taken";
      }
      if (why) {
        notes.push(`Asked for ${asked}, but ${why} - call to set a time`);
        visitBooked = false;
      }
    } catch (e) {
      console.error("[quote] availability check failed - saving without the slot", e);
      notes.push(`Asked for ${asked}; the calendar couldn't be checked - confirm the time`);
      visitBooked = false;
    }
    if (!visitBooked) {
      visitDate = "";
      visitTime = "";
    }
  }

  // visit_date's meaning depends on quote_type: a booked appointment for
  // in-person, an offered fallback slot for online. Online becomes an
  // appointment only when a contractor confirms it (flipping the type).
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(visitDate) ? visitDate : null;
  const row: Record<string, unknown> = {
    name,
    phone: phoneRaw,
    email: email || null,
    service: service || null,
    address,
    city: city || null,
    details: [notes.length ? `[${notes.join(". ")}.]` : "", details].filter(Boolean).join("\n\n").slice(0, LIMITS.details) || null,
    quote_type: quoteType || null,
    // Written with the row, so the visit is never briefly unassigned (when a
    // second booking could slip in).
    assigned_to: assignee,
    // Mirrors visit_time, from what was kept, so a dropped slot isn't read as a booking.
    preferred_time: visitTime || null,
    visit_date: validDate,
    visit_time: visitTime || null,
    file_urls: fileUrls,
    source_path: sourcePath || null,
    client_submission_id: submissionId,
  };

  if (trapped) {
    // Archived with the visit removed (the calendar shows any row with a visit
    // date, archived or not). The request is kept in the details for a restore.
    const note = `[Held for review: the hidden spam-trap field was filled ("${trapValue.slice(0, 40)}"). Requested ${quoteType || "quote"}${validDate ? ` visit ${validDate}${visitTime ? ` ${visitTime}` : ""}` : ""}.]`;
    row.details = [note, row.details].filter(Boolean).join("\n\n").slice(0, LIMITS.details);
    row.visit_date = null;
    row.visit_time = null;
    row.preferred_time = null;
    row.archived_at = new Date().toISOString();
  }

  let inserted = await insertLead(row);

  // No answer or a 5xx is usually a blip: retry once, after checking the first
  // attempt didn't land anyway (it can succeed and still time out).
  if (!inserted.ok && (inserted.status === 0 || inserted.status >= 500)) {
    console.warn("[quote] insert failed, retrying once", inserted.status, inserted.detail.slice(0, 200));
    await new Promise((r) => setTimeout(r, 600));
    const landed = submissionId ? await findBySubmissionId(submissionId) : null;
    inserted = landed ? { ok: true, id: landed } : await insertLead(row);
  }

  // If client_submission_id is missing (lead-idempotency.sql), saving the lead
  // matters more than de-duplicating it.
  if (!inserted.ok && inserted.status === 400 && /client_submission_id/.test(inserted.detail)) {
    console.error("[quote] client_submission_id column missing - run supabase/lead-idempotency.sql; saving without it");
    const { client_submission_id: _drop, ...withoutId } = row;
    void _drop;
    inserted = await insertLead(withoutId);
  }

  // A retry of a form already saved (timeout, double tap): the unique index
  // refused it, so answer with the existing row.
  if (!inserted.ok && inserted.status === 409 && submissionId) {
    const existing = await findBySubmissionId(submissionId);
    if (existing) {
      console.warn("[quote] duplicate submission - returning the lead already saved", { lead: existing });
      const vb = await visitBookedFor(existing);
      return NextResponse.json({ ok: true, saved: true, lead_id: existing, duplicate: true, visit_booked: vb }, { status: 200 });
    }
  }

  if (!inserted.ok) {
    // With the DB's reason and enough to call them back, in case they don't call us.
    console.error("[quote] insert failed - lead NOT saved", inserted.status, inserted.detail.slice(0, 500), {
      name,
      phone: phoneRaw,
      service,
    });
    alertUnsaved(
      inserted.status
        ? `database error ${inserted.status}`
        : "no answer from the database - it may have saved late, so check the pipeline first",
      row,
    );
    return fail(502, SAVE_FAILED);
  }

  // Saved but not returned (return=representation should always return it):
  // look it up by the form's id. Without an id, don't show success; a retry is
  // safe because the unique index finds this row.
  const leadId = inserted.id ?? (submissionId ? await findBySubmissionId(submissionId) : null);
  if (!leadId) {
    console.error("[quote] insert returned no row id - lead probably saved, not confirmed to the customer", {
      name,
      phone: phoneRaw,
      submissionId,
    });
    alertUnsaved("saved but not confirmed - check the pipeline before calling", row);
    return fail(502, SAVE_FAILED);
  }

  if (!SERVICE_KEY) {
    console.error("[quote] SUPABASE_SERVICE_ROLE_KEY is not set - cannot auto-assign or look up owner numbers");
  }

  const ref = leadReference(leadId);
  if (trapped) {
    console.warn("[quote] spam-trap field filled - lead saved to Archived", { lead: leadId, name, phone: phoneRaw });
    afterResponse(async () => {
      await alertOwner(
        [
          "POSSIBLE SPAM - held in Archived",
          "",
          "The hidden spam-trap field on the quote form was filled, but everything else looked real. Check it isn't a customer:",
          "",
          `Name: ${name}`,
          `Phone: ${phoneRaw}`,
          service ? `Service: ${service}` : null,
          `Address: ${address}`,
          `Ref: ${ref}`,
          "",
          "CRM > Archived > Restore if it's genuine. They have NOT been texted.",
        ]
          .filter((l) => l !== null)
          .join("\n"),
        null,
        { quoteId: leadId, kind: "spam_trap" },
      );
    });
  } else {
    afterResponse(async () => {
      // The assignment went in with the row; just look up who to text.
      let contractorPhone: string | null = null;
      let contractorName: string | null = null;
      if (assignee) {
        const contact = await getStaffContactById(assignee).catch(() => null);
        contractorPhone = contact?.phone ?? null;
        contractorName = contact?.full_name ?? null;
      }
      const info = {
        id: leadId,
        name,
        phone: phoneRaw,
        service,
        address,
        // Notes on top, so the owner's text flags "no time picked" etc.
        details: (row.details as string | null) ?? "",
        quote_type: (row.quote_type as string | null) ?? undefined,
        visit_date: validDate,
        visit_time: visitTime || null,
        public_token: inserted.ok ? inserted.publicToken : undefined,
        job_token: inserted.ok ? inserted.jobToken : undefined,
      };
      // Separately, so one failing doesn't stop the other.
      await notifyNewQuote(info, contractorPhone, contractorName).catch((e) =>
        console.error("[quote] new-lead alert failed", e),
      );
      await notifyCustomerReceived(info).catch((e) => console.error("[quote] customer acknowledgement failed", e));
    });
  }

  await markDraftSent(submissionId, leadId);

  return NextResponse.json({ ok: true, saved: true, lead_id: leadId, visit_booked: visitBooked && !trapped }, { status: 201 });
}
