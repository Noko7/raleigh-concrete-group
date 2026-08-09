import { NextResponse } from "next/server";

import { ADDRESS_HINT, isFullAddress } from "@/lib/address";
import { VISIT_LEAD_DAYS, VISIT_TIME_SLOTS } from "@/lib/crm/constants";
import { notifyCustomerReceived, notifyNewQuote } from "@/lib/crm/notify";
import {
  MAX_VISITS_PER_DAY,
  countVisitsOn,
  getPrimaryContractorId,
  getStaffContactById,
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
  // In-person quotes must pick a real date + time so the crew can calendar it.
  if (quoteType === "inperson") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(visitDate)) {
      errors.push("visit_date");
    } else {
      // No visits in the past, and none inside the lead time. One day of slack
      // for time zones, matching how preferred install days are checked.
      const earliest = Date.now() + (VISIT_LEAD_DAYS - 1) * 24 * 60 * 60 * 1000;
      const picked = new Date(`${visitDate}T00:00:00Z`).getTime();
      if (!Number.isFinite(picked) || picked < earliest) errors.push("visit_date");
    }
    if (!VISIT_TIME_SLOTS.includes(visitTime)) errors.push("visit_time");
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

  // Don't overbook in-person quote visits (max per day).
  if (quoteType === "inperson") {
    const used = await countVisitsOn(visitDate);
    if (used >= MAX_VISITS_PER_DAY) {
      return NextResponse.json(
        { ok: false, error: "That day is fully booked for visits. Please choose another date.", fields: ["visit_date"] },
        { status: 409 },
      );
    }
  }

  const row = {
    name,
    phone: phoneRaw,
    email: email || null,
    service: service || null,
    address,
    city: city || null,
    details: details || null,
    quote_type: QUOTE_TYPES.has(quoteType) ? quoteType : null,
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

    // Auto-assign to the primary contractor (owner-selectable in Settings), then
    // text the owner + contractor and acknowledge the customer. All best-effort.
    if (newRow?.id && SERVICE_KEY) {
      let contractorPhone: string | null = null;
      let contractorName: string | null = null;
      try {
        const primaryId = await getPrimaryContractorId();
        if (primaryId) {
          await fetch(`${SUPABASE_URL}/rest/v1/quote_requests?id=eq.${newRow.id}`, {
            method: "PATCH",
            headers: {
              apikey: SERVICE_KEY,
              Authorization: `Bearer ${SERVICE_KEY}`,
              "Content-Type": "application/json",
              Prefer: "return=minimal",
            },
            body: JSON.stringify({ assigned_to: primaryId }),
          });
          const contact = await getStaffContactById(primaryId);
          contractorPhone = contact?.phone ?? null;
          contractorName = contact?.full_name ?? null;
        }
      } catch {
        // assignment is best-effort; the quote is already saved
      }

      const info = {
        name,
        phone: phoneRaw,
        service,
        address,
        details,
        quote_type: row.quote_type ?? undefined,
        visit_date: row.visit_date,
        visit_time: row.visit_time,
        public_token: newRow.public_token,
        job_token: newRow.job_token,
      };
      await notifyNewQuote(info, contractorPhone, contractorName).catch(() => {});
      await notifyCustomerReceived(info).catch(() => {});
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "Could not save. Please call us." }, { status: 502 });
  }
}
