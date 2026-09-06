import { NextResponse } from "next/server";

import { ADDRESS_HINT, isFullAddress } from "@/lib/address";
import { ymdInDays } from "@/lib/crm/clock";
import { TIME_RE, VISIT_LEAD_DAYS } from "@/lib/crm/constants";
import { notifyCustomerReceived, notifyNewQuote } from "@/lib/crm/notify";
import {
  findVisitConflict,
  getStaffContactById,
  resolveAssignee,
  visitAvailability,
} from "@/lib/crm/queries";
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

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  // Honeypot: real users never see/fill this. Pretend success and drop it.
  if (asString(body.company, 100) !== "") {
    return NextResponse.json({ ok: true });
  }

  const ip = clientIp(request);
  if (await rateLimit(`quote:${ip}`, 8, 10 * 60 * 1000)) {
    return NextResponse.json({ ok: false, error: "Too many requests. Please call us." }, { status: 429 });
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

  if (!CONFIGURED) {
    // No keys configured (e.g. preview without env) - accept but don't persist.
    return NextResponse.json({ ok: true, demo: true });
  }

  // Who this lead belongs to, resolved once and used for three things: the slot
  // check below, the row we insert, and the text they get. It used to be worked
  // out after the insert, which meant the availability check and the row could
  // disagree about whose calendar the visit landed on.
  const assignee = SERVICE_KEY ? await resolveAssignee(service) : null;

  // Don't put the crew in two places. Visits stack an hour apart on one
  // person's day, so what's checked is that person's window and the hour of
  // clearance around anything already on it.
  //
  // The message stays vague on purpose: this endpoint answers to anyone, and
  // "already with Jane Smith at 10am" would hand a stranger a customer's name
  // and schedule. Staff screens get the specific version via conflictMessage.
  if (quoteType === "inperson") {
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
  const row = {
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
    visit_date: /^\d{4}-\d{2}-\d{2}$/.test(visitDate) ? visitDate : null,
    visit_time: visitTime || null,
    file_urls: fileUrls,
    source_path: sourcePath || null,
  };

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/quote_requests`, {
      method: "POST",
      headers: {
        apikey: WRITE_KEY,
        Authorization: `Bearer ${WRITE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(row),
    });
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: "Could not save. Please call us." }, { status: 502 });
    }

    const created = (await res.json().catch(() => [])) as Array<{
      id?: string;
      job_token?: string;
      public_token?: string;
    }>;
    const newRow = created[0];

    // These two are the difference between a lead you know about and one you
    // don't, so when either is missing say so loudly in the logs. Both used to
    // gate the whole notification block, which meant a missing service key
    // turned every new lead into silence that looked exactly like success.
    if (!newRow?.id) {
      console.error("[quote] saved, but the row could not be read back - alerts will have no job link");
    }
    if (!SERVICE_KEY) {
      console.error("[quote] SUPABASE_SERVICE_ROLE_KEY is not set - cannot auto-assign or look up owner numbers");
    }

    // The assignment itself already went in with the row above. All that's
    // left is looking up who to text.
    let contractorPhone: string | null = null;
    let contractorName: string | null = null;
    if (assignee) {
      try {
        const contact = await getStaffContactById(assignee);
        contractorPhone = contact?.phone ?? null;
        contractorName = contact?.full_name ?? null;
      } catch {
        // best-effort; the quote is already saved and the owner alert still goes
      }
    }

    // Text regardless of whether the two steps above worked. An alert naming the
    // customer and their number is worth sending even with no job link attached:
    // you can still call them back, which is the entire point of the alert.
    const info = {
      id: newRow?.id,
      name,
      phone: phoneRaw,
      service,
      address,
      details,
      quote_type: row.quote_type ?? undefined,
      visit_date: row.visit_date,
      visit_time: row.visit_time,
      public_token: newRow?.public_token,
      job_token: newRow?.job_token,
    };
    await notifyNewQuote(info, contractorPhone, contractorName).catch((e) => {
      console.error("[quote] new-lead alert failed", e);
    });
    await notifyCustomerReceived(info).catch((e) => {
      console.error("[quote] customer acknowledgement failed", e);
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "Could not save. Please call us." }, { status: 502 });
  }
}
