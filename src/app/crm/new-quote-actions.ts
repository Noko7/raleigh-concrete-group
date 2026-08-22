"use server";

import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/crm/auth";
import { notifyAssignment } from "@/lib/crm/notify";
import { addEvent, getPrimaryContractorId, getStaffContactById, insertQuote } from "@/lib/crm/queries";
import type { Quote } from "@/lib/crm/types";

export type NewQuoteState = { ok: boolean; error?: string; id?: string };

const QUOTE_TYPES = new Set(["online", "inperson"]);
// Matches the public form's own check (src/app/api/quote/route.ts) - the DB's
// qr_chk constraint validates this too, but failing here gives a real error
// instead of a generic "could not save".
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// A lead logged from the phone, straight into the CRM - name and phone are
// the only things the database actually requires (see supabase/schema.sql's
// qr_chk), so everything else here is optional. Owner-only, enforced here and
// by the "owner inserts quotes" RLS policy (supabase/manual-quote.sql) -
// contractors work leads, they don't create them. Auto-assigns to the same
// primary contractor the public form uses, so a phoned-in lead is followed up
// on exactly like a web one. Deliberately doesn't text the customer anything
// (notifyCustomerReceived is for an unattended web submission - the staff
// member creating this row is on the phone with them right now).
export async function createQuote(_prev: NewQuoteState, formData: FormData): Promise<NewQuoteState> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Your session expired. Please sign in again." };
  if (session.staff.role !== "owner") return { ok: false, error: "Owners only." };

  const name = String(formData.get("name") ?? "").trim().slice(0, 120);
  const phoneRaw = String(formData.get("phone") ?? "").trim().slice(0, 32);
  const phoneDigits = phoneRaw.replace(/\D/g, "");
  if (name.length < 2) return { ok: false, error: "Enter the customer's name." };
  if (!(phoneDigits.length === 10 || (phoneDigits.length === 11 && phoneDigits.startsWith("1")))) {
    return { ok: false, error: "Enter a 10-digit US phone number." };
  }

  const email = String(formData.get("email") ?? "").trim().slice(0, 200);
  if (email && !EMAIL_RE.test(email)) return { ok: false, error: "That email address doesn't look right." };
  const service = String(formData.get("service") ?? "").trim().slice(0, 120);
  const address = String(formData.get("address") ?? "").trim().slice(0, 300);
  const city = String(formData.get("city") ?? "").trim().slice(0, 120);
  const details = String(formData.get("details") ?? "").trim().slice(0, 2000);
  const quoteTypeRaw = String(formData.get("quote_type") ?? "").trim();
  const quoteType = QUOTE_TYPES.has(quoteTypeRaw) ? quoteTypeRaw : null;

  const row: Partial<Quote> = {
    name,
    phone: phoneRaw,
    email: email || null,
    service: service || null,
    address: address || null,
    city: city || null,
    details: details || null,
    quote_type: quoteType,
    // Marks how this lead came in, same field the public form stamps with the
    // page it was submitted from - the pipeline can tell the two apart.
    source_path: "crm:manual",
  };

  const primaryId = await getPrimaryContractorId().catch(() => null);
  if (primaryId) row.assigned_to = primaryId;

  const created = await insertQuote(session, row);
  if (!created) return { ok: false, error: "Could not save. Check your access and try again." };

  await addEvent(session, created.id, "quote_created_manually", { by: session.staff.full_name || session.staff.email });

  if (created.assigned_to) {
    const contractor = await getStaffContactById(created.assigned_to);
    await notifyAssignment(
      contractor?.phone,
      {
        id: created.id,
        name: created.name,
        phone: created.phone,
        service: created.service,
        address: created.address,
        quote_type: created.quote_type,
        visit_date: created.visit_date,
        visit_time: created.visit_time,
        job_token: created.job_token,
      },
      contractor?.full_name,
    ).catch(() => {});
  }

  revalidatePath("/crm");
  return { ok: true, id: created.id };
}
