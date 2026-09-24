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

// All quote submissions go through this server-side endpoint. The browser never
// writes to the database directly: we validate everything here and insert with
// the secret service-role key (server-only). Combined with RLS (which blocks the
// public anon key from reading or writing the table), your customer data can't
// be scraped or spammed straight from the client.
//
// THE RULE (24 Sep 2026): a request with a name and a phone number we can call
// is saved. Always. Nothing else it carries - an address the form couldn't
// verify, an email with a typo, a visit slot that went while they were typing,
// a calendar we couldn't read, photos that didn't upload - is a reason to turn
// a customer away. Each of those becomes a note at the top of the lead's
// details for the office to sort out on the phone, and the customer is told
// the truth about it on the success screen. The only refusals left are a
// missing name or number, a rate limit, and a database that won't take the
// row - and that last one texts the owner the lead in full.

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
// Prefer the service-role key (bypasses RLS, table stays locked to the public).
// Fall back to anon only if a service key isn't configured.
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
// Deliberately narrower than QUOTE_TYPES in constants.ts. "plans" is a
// commercial route the office opens on a call after seeing what the job is;
// it is not something the public form should let anyone self-select.
const QUOTE_TYPES = new Set(["online", "inperson"]);

function asString(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

// What the customer is told whenever their request did NOT reach the database.
// Always with the number, because "try again" alone is a dead end if the thing
// that's broken is us.
const SAVE_FAILED = "We couldn't save your request just now. Please call or text us at (919) 873-3919.";

// Every failure answers in this shape. `saved: false` is explicit so there is
// no response from this route that a client could mistake for a save - see
// src/lib/quote-submit.ts for the rule the forms apply.
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
    // Network failure or the 10s deadline. Status 0 = "didn't get an answer",
    // which the caller treats as worth one retry.
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

// Whether a row already saved has a visit on it: the answer a retry of the same
// form needs, so its success screen says the same thing the first would have.
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

// Runs the texts once the response has gone, so a slow SMS provider can never
// hold up (or time out) the answer the customer is waiting for. Before this, the
// alerts ran first: a lead could be saved and the function killed mid-text,
// and the customer saw an error for a request we had - and sent it again.
function afterResponse(work: () => Promise<void>) {
  try {
    after(() => work().catch((e) => console.error("[quote] post-save notification failed", e)));
  } catch {
    // Outside a request (a script, a test): nothing to defer to.
    void work().catch((e) => console.error("[quote] post-save notification failed", e));
  }
}

// The database wouldn't take the row. The customer is being told to call or
// text us, but if they don't, this text to the owner is the only place the
// lead exists - so it carries everything needed to call them back.
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

// Marks the in-progress copy of this form as sent, so it drops off the CRM's
// "started, not sent" list and its tab closing later doesn't alert anyone.
// Best effort: the lead is already saved, which is the part that matters.
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
  // Nothing below is allowed to escape as an unlogged 500 with an HTML body.
  // Whatever happens, the customer gets our number and the logs get the reason.
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

  // The hidden trap field. It is NOT a reason to throw a request away any
  // more: until 23 Sep a filled trap got a fake "you're all set" and nothing
  // was kept, and a real customer lost that way cannot be found again. Now a
  // trapped request that passes every check below is saved - into Archived,
  // off the calendar and the pipeline, with nobody texted but the owner.
  //
  // A trapped request is held to the old strict bar (a full street address),
  // because it is the one kind that texts the owner without being a lead, and
  // bots rarely produce a findable address. A real person who trips it has
  // autofill to thank, and autofill fills in the whole address.
  const trapValue = asString(body.company, 100);
  const trapped = trapValue !== "";

  const ip = clientIp(request);
  // Generous: every refusal here is somebody told to phone instead. Twelve in
  // ten minutes is well past a customer retrying through errors.
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

  // Only what we can't call them back without. Everything else below is a
  // note on the lead, never a refusal (see THE RULE at the top).
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

  // Things the office should know when they pick this up. Written to the top of
  // the details, where the lead card, the owner's text and the crew's all show it.
  const notes: string[] = [];

  let email = emailRaw;
  if (email && !EMAIL_RE.test(email)) {
    notes.push(`Email looked mistyped: "${email.slice(0, 80)}"`);
    email = "";
  }
  if (!address) notes.push("No address given - ask for it");
  else if (!isFullAddress(address)) notes.push("Address may be incomplete - confirm it");
  // Only the pop-up posts here and it only sends these two; anything else is a
  // tampered request, and still a person with a phone number.
  const quoteType = QUOTE_TYPES.has(quoteTypeRaw) ? quoteTypeRaw : "";

  // The visit. Optional for both types now: an online customer can skip the
  // fallback, and an in-person one who can't find a time that suits can send
  // it and be called. When they did pick one, it's kept if it's a real day
  // inside the lead time and a real slot; otherwise it's dropped into a note.
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

  // file_urls: only accept paths we created in our own bucket.
  let fileUrls: string[] | null = null;
  if (Array.isArray(body.file_urls)) {
    const cleaned = body.file_urls
      .filter((p): p is string => typeof p === "string")
      .map((p) => p.trim().slice(0, LIMITS.filePath))
      .filter((p) => p.startsWith("quote-uploads/"))
      .slice(0, LIMITS.files);
    fileUrls = cleaned.length ? cleaned : null;
  }
  // Photos the form tried and failed to upload. They're told on the success
  // screen to text them over; the office is told to expect them.
  const filesFailed = typeof body.files_failed === "number" && body.files_failed > 0 ? Math.min(Math.floor(body.files_failed), 20) : 0;
  if (filesFailed) {
    notes.push(`${filesFailed} photo${filesFailed === 1 ? "" : "s"} failed to upload - they were asked to text ${filesFailed === 1 ? "it" : "them"}`);
  }

  // One id per filled-in form, the same on every retry of it (quote-submit.ts).
  // Anything that isn't a UUID is ignored rather than trusted.
  const submissionIdRaw = asString(body.submission_id, 64);
  const submissionId = UUID_RE.test(submissionIdRaw) ? submissionIdRaw.toLowerCase() : null;

  if (!CONFIGURED) {
    // No database keys. This used to answer ok+demo, and the form celebrated a
    // request that went nowhere. There is no environment in which that is the
    // right answer to give a customer.
    console.error("[quote] Supabase is not configured - lead NOT saved", { name, phone: phoneRaw });
    alertUnsaved("the site has no database keys", { name, phone: phoneRaw, address, service, quote_type: quoteType });
    return fail(503, SAVE_FAILED);
  }

  // Who this lead belongs to, resolved once and used for three things: the slot
  // check below, the row we insert, and the text they get. A trapped request is
  // held in Archived and belongs to nobody until the owner restores it.
  //
  // These are reads that can fail, and a failed read must not cost the lead:
  // before this, a database hiccup here threw, and the customer got an error
  // for a request we could perfectly well have saved.
  let assignee: string | null = null;
  if (SERVICE_KEY && !trapped) {
    assignee = await resolveAssignee(service).catch((e) => {
      console.error("[quote] could not resolve assignee - saving unassigned", e);
      notes.push("Couldn't auto-assign - assign it by hand");
      return null;
    });
  }

  // Don't put the crew in two places. Visits stack an hour apart on one
  // person's day, so what's checked is that person's window and the hour of
  // clearance around anything already on it.
  //
  // A slot that fails the check no longer sends the customer back to pick
  // again - three refusals on 7 Sep and a customer on 18 Sep who cycled dates
  // until they gave up are what that cost. The request is saved without the
  // slot, the note says what they asked for, and the success screen tells them
  // we'll call to set a time. The form still greys out taken times, so this is
  // the rare race, not the normal path.
  //
  // The reason stays out of the customer's view on purpose: this endpoint
  // answers to anyone, and "already with Jane Smith at 10am" would hand a
  // stranger a customer's name and schedule.
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

  // visit_date holds both meanings and quote_type is what separates them: on an
  // in-person row it's a booked appointment, on an online row it's the slot the
  // customer offered in case we can't price the job from photos. Nothing treats
  // an online row as an appointment until a contractor confirms it, which is
  // what flips the type to inperson.
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
    // Written with the row rather than patched in afterwards, so the visit
    // never exists for even a moment on nobody's calendar - which is the window
    // a second booking used to slip through.
    assigned_to: assignee,
    // Mirrors visit_time. Taken from what was kept, not what was sent, so a
    // slot dropped above doesn't survive here and get read as a booking.
    preferred_time: visitTime || null,
    visit_date: validDate,
    visit_time: visitTime || null,
    file_urls: fileUrls,
    source_path: sourcePath || null,
    client_submission_id: submissionId,
  };

  if (trapped) {
    // Archived, and with the visit taken off the row (the calendar shows any
    // row with a visit date, archived or not). What they asked for is kept in
    // the details so nothing is lost if the owner restores it.
    const note = `[Held for review: the hidden spam-trap field was filled ("${trapValue.slice(0, 40)}"). Requested ${quoteType || "quote"}${validDate ? ` visit ${validDate}${visitTime ? ` ${visitTime}` : ""}` : ""}.]`;
    row.details = [note, row.details].filter(Boolean).join("\n\n").slice(0, LIMITS.details);
    row.visit_date = null;
    row.visit_time = null;
    row.preferred_time = null;
    row.archived_at = new Date().toISOString();
  }

  let inserted = await insertLead(row);

  // No answer, or the database's own 5xx: most often a blip. One retry, after
  // checking the first attempt didn't land anyway (it can succeed and still
  // time out on the way back).
  if (!inserted.ok && (inserted.status === 0 || inserted.status >= 500)) {
    console.warn("[quote] insert failed, retrying once", inserted.status, inserted.detail.slice(0, 200));
    await new Promise((r) => setTimeout(r, 600));
    const landed = submissionId ? await findBySubmissionId(submissionId) : null;
    inserted = landed ? { ok: true, id: landed } : await insertLead(row);
  }

  // The column this relies on arrives with supabase/lead-idempotency.sql. If a
  // database is behind, saving the lead matters more than de-duplicating it.
  if (!inserted.ok && inserted.status === 400 && /client_submission_id/.test(inserted.detail)) {
    console.error("[quote] client_submission_id column missing - run supabase/lead-idempotency.sql; saving without it");
    const { client_submission_id: _drop, ...withoutId } = row;
    void _drop;
    inserted = await insertLead(withoutId);
  }

  // A second attempt of a form we already saved (a retry after a timeout, a
  // double tap). The unique index refused it; answer with the row we have.
  if (!inserted.ok && inserted.status === 409 && submissionId) {
    const existing = await findBySubmissionId(submissionId);
    if (existing) {
      console.warn("[quote] duplicate submission - returning the lead already saved", { lead: existing });
      const vb = await visitBookedFor(existing);
      return NextResponse.json({ ok: true, saved: true, lead_id: existing, duplicate: true, visit_booked: vb }, { status: 200 });
    }
  }

  if (!inserted.ok) {
    // Logged with the database's own reason and enough to call them back: the
    // customer is being told to phone us, and this is how we'd know to phone
    // them if they don't.
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

  // Saved, but the row didn't come back (it always should with
  // return=representation). Look it up by the form's id; without an id to hand
  // the browser, it must not show success - and a retry is safe, because the
  // unique index will find this row rather than write a second one.
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
      // The assignment itself already went in with the row above. All that's
      // left is looking up who to text.
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
        // With the notes on top, so the owner's text says "no time picked" or
        // "address may be incomplete" rather than leaving them to find it.
        details: (row.details as string | null) ?? "",
        quote_type: (row.quote_type as string | null) ?? undefined,
        visit_date: validDate,
        visit_time: visitTime || null,
        public_token: inserted.ok ? inserted.publicToken : undefined,
        job_token: inserted.ok ? inserted.jobToken : undefined,
      };
      // Each on its own, so the customer's acknowledgement still goes if the
      // owner alert throws, and the other way round.
      await notifyNewQuote(info, contractorPhone, contractorName).catch((e) =>
        console.error("[quote] new-lead alert failed", e),
      );
      await notifyCustomerReceived(info).catch((e) => console.error("[quote] customer acknowledgement failed", e));
    });
  }

  await markDraftSent(submissionId, leadId);

  return NextResponse.json({ ok: true, saved: true, lead_id: leadId, visit_booked: visitBooked && !trapped }, { status: 201 });
}
