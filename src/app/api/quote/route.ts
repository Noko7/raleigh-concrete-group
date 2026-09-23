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
import { leadReference, UUID_RE } from "@/lib/quote-submit";
import { clientIp, rateLimit } from "@/lib/rate-limit";

// All quote submissions go through this server-side endpoint. The browser never
// writes to the database directly: we validate everything here and insert with
// the secret service-role key (server-only). Combined with RLS (which blocks the
// public anon key from reading or writing the table), your customer data can't
// be scraped or spammed straight from the client.

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
const SAVE_FAILED = "We couldn't save your request just now. Please call us at (919) 873-3919.";

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
  const res = await fetch(`${SUPABASE_URL}/rest/v1/quote_requests`, {
    method: "POST",
    cache: "no-store",
    headers: {
      apikey: WRITE_KEY,
      Authorization: `Bearer ${WRITE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(row),
  });
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

// The row an earlier attempt of this same form already saved, if any.
async function findBySubmissionId(submissionId: string): Promise<string | null> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/quote_requests?client_submission_id=eq.${encodeURIComponent(submissionId)}&select=id&limit=1`,
    { cache: "no-store", headers: { apikey: WRITE_KEY, Authorization: `Bearer ${WRITE_KEY}` } },
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
  // off the calendar and the pipeline, with nobody texted but the owner - and
  // one that doesn't pass is rejected like any other. Bots rarely produce a
  // full street address, a real phone number and a bookable date.
  const trapValue = asString(body.company, 100);
  const trapped = trapValue !== "";

  const ip = clientIp(request);
  if (await rateLimit(`quote:${ip}`, 8, 10 * 60 * 1000)) {
    console.warn("[quote] rate limited", { ip });
    return fail(429, "Too many requests. Please call us at (919) 873-3919.");
  }

  // ── Validate ──
  const name = asString(body.name, LIMITS.name);
  const phoneRaw = asString(body.phone, LIMITS.phone);
  const phoneDigits = phoneRaw.replace(/\D/g, "");
  const email = asString(body.email, LIMITS.email);
  const service = asString(body.service, LIMITS.service);
  const address = asString(body.address, LIMITS.address);
  const city = asString(body.city, LIMITS.city);
  const details = asString(body.details, LIMITS.details);
  const quoteType = asString(body.quote_type, 16);
  const preferredTime = asString(body.preferred_time, LIMITS.preferred_time);
  const visitDate = asString(body.visit_date, 10);
  const visitTime = asString(body.visit_time, 40);
  const sourcePath = asString(body.source_path, LIMITS.source_path);

  const errors: string[] = [];
  if (name.length < 2) errors.push("name");
  if (!(phoneDigits.length === 10 || (phoneDigits.length === 11 && phoneDigits.startsWith("1")))) errors.push("phone");
  if (email && !EMAIL_RE.test(email)) errors.push("email");
  // Must be findable on a map: house number, street, city and state. The form
  // checks this too, but the form is the part an attacker controls.
  if (!isFullAddress(address)) errors.push("address");
  if (quoteType && !QUOTE_TYPES.has(quoteType)) errors.push("quote_type");
  // Both quote types pick a date and time, and both are checked the same way -
  // an online request's slot is a fallback rather than a booking, but a fallback
  // set for last Tuesday is no use to the contractor who has to confirm it.
  // (The pop-up is the only form that posts here; the /estimate page, which
  // asked for neither and so could never pass this, was retired on 23 Sep.)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(visitDate)) {
    errors.push("visit_date");
  } else {
    // No visits in the past, and none inside the lead time. Both sides are
    // Raleigh calendar dates now, so this is an exact day count rather than a
    // millisecond comparison that needed a day of slack to survive time zones.
    if (visitDate < ymdInDays(VISIT_LEAD_DAYS)) errors.push("visit_date");
  }
  // Shape only here. Which slots actually exist depends on the contractor this
  // lead routes to, which needs a database round-trip, so it is checked below
  // once we know whose day it is.
  if (!TIME_RE.test(visitTime)) errors.push("visit_time");

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

  if (errors.length) {
    // Name the actual problem. "Please check your details" on a form the
    // customer thinks they filled in correctly is a dead end.
    const message = errors.includes("address")
      ? ADDRESS_HINT
      : errors.includes("visit_date")
        ? `Please pick a visit date at least ${VISIT_LEAD_DAYS} days from today.`
        : errors.includes("phone")
          ? "Please enter a 10-digit US phone number."
          : "Please check your details.";
    return NextResponse.json({ ok: false, error: message, fields: errors }, { status: 422 });
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
    return fail(503, SAVE_FAILED);
  }

  // Who this lead belongs to, resolved once and used for three things: the slot
  // check below, the row we insert, and the text they get. A trapped request is
  // held in Archived and belongs to nobody until the owner restores it.
  const assignee = SERVICE_KEY && !trapped ? await resolveAssignee(service) : null;

  // Don't put the crew in two places. Visits stack an hour apart on one
  // person's day, so what's checked is that person's window and the hour of
  // clearance around anything already on it.
  //
  // The message stays vague on purpose: this endpoint answers to anyone, and
  // "already with Jane Smith at 10am" would hand a stranger a customer's name
  // and schedule. Staff screens get the specific version via conflictMessage.
  if (quoteType === "inperson" && !trapped) {
    const { slots, works, wholeDay } = await visitAvailability(assignee, visitDate);
    if (!works || wholeDay) {
      return NextResponse.json(
        {
          ok: false,
          error: wholeDay
            ? "We're booked on a job that day. Please choose another date."
            : "We don't take visits that day. Please choose another date.",
          fields: ["visit_date"],
        },
        { status: 409 },
      );
    }
    // A time outside their hours can only come from a stale form or a tampered
    // one, and it is a 409 rather than a 422 because the honest cause is a form
    // that was open while somebody changed their working hours.
    if (!slots.includes(visitTime)) {
      return NextResponse.json(
        { ok: false, error: "That time isn't available. Please pick one of the times shown.", fields: ["visit_time"] },
        { status: 409 },
      );
    }
    const clash = await findVisitConflict(assignee, visitDate, visitTime);
    if (clash) {
      return NextResponse.json(
        {
          ok: false,
          error:
            clash.kind === "job"
              ? "We're booked on a job that day. Please choose another date."
              : "That time has just been taken. Please choose another time.",
          fields: ["visit_time"],
        },
        { status: 409 },
      );
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
    details: details || null,
    quote_type: QUOTE_TYPES.has(quoteType) ? quoteType : null,
    // Written with the row rather than patched in afterwards, so the visit
    // never exists for even a moment on nobody's calendar - which is the window
    // a second booking used to slip through.
    assigned_to: assignee,
    preferred_time: preferredTime || null,
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
    row.details = `${note}${details ? `\n\n${details}` : ""}`.slice(0, LIMITS.details);
    row.visit_date = null;
    row.visit_time = null;
    row.preferred_time = null;
    row.archived_at = new Date().toISOString();
  }

  let inserted = await insertLead(row);

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
      return NextResponse.json({ ok: true, saved: true, lead_id: existing, duplicate: true }, { status: 200 });
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
        details,
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

  return NextResponse.json({ ok: true, saved: true, lead_id: leadId }, { status: 201 });
}
