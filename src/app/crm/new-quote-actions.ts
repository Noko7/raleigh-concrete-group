"use server";

import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/crm/auth";
import { QUOTE_TYPES, to12Hour } from "@/lib/crm/constants";
import { notifyAssignment, notifyCustomMessage, notifyVisitBooked } from "@/lib/crm/notify";
import {
  addEvent,
  conflictMessage,
  findVisitConflict,
  getStaffContactById,
  insertQuote,
  resolveAssignee,
} from "@/lib/crm/queries";
import type { Quote } from "@/lib/crm/types";

export type NewQuoteState = { ok: boolean; error?: string; id?: string };
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
  const quoteType = (QUOTE_TYPES as readonly string[]).includes(quoteTypeRaw) ? quoteTypeRaw : null;

  const customMessage = String(formData.get("custom_message") ?? "").trim().slice(0, 1000);

  // An in-person call-in books the estimate then and there, while the
  // customer is still on the phone to agree to it. Stored the same way a web
  // booking is: quote_type "inperson" is what makes visit_date a real
  // appointment rather than a slot somebody offered.
  let visitDate: string | null = null;
  let visitTime: string | null = null;
  if (quoteType === "inperson") {
    const rawDate = String(formData.get("visit_date") ?? "").slice(0, 10);
    const rawTime = String(formData.get("visit_time") ?? "").slice(0, 5);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) return { ok: false, error: "Pick a date for the estimate." };
    if (!/^\d{2}:\d{2}$/.test(rawTime)) return { ok: false, error: "Pick a time for the estimate." };
    visitDate = rawDate;
    visitTime = to12Hour(rawTime);
  }

  const row: Partial<Quote> = {
    name,
    phone: phoneRaw,
    email: email || null,
    service: service || null,
    address: address || null,
    city: city || null,
    details: details || null,
    quote_type: quoteType,
    visit_date: visitDate,
    visit_time: visitTime,
    // Marks how this lead came in, same field the public form stamps with the
    // page it was submitted from - the pipeline can tell the two apart.
    source_path: "crm:manual",
  };

  // An explicit pick wins over the job-type rules. Commercial work in
  // particular is often a specific person's regardless of what the service
  // says, and the office knows that on the call.
  const pickedAssignee = String(formData.get("assigned_to") ?? "").trim();
  if (pickedAssignee && !/^[0-9a-fA-F-]{36}$/.test(pickedAssignee)) {
    return { ok: false, error: "Pick a valid contractor." };
  }
  const assigneeId = pickedAssignee || (await resolveAssignee(service).catch(() => null));

  // Don't put whoever gets this job in two places at once. Checked before the
  // row is written so the office can offer another time while still on the
  // call, rather than finding out on the morning.
  if (assigneeId && visitDate && visitTime) {
    const clash = await findVisitConflict(assigneeId, visitDate, visitTime);
    if (clash) return { ok: false, error: conflictMessage(clash) };
  }

  if (assigneeId) row.assigned_to = assigneeId;

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

  // Whatever the office promised on the call, in writing. Sent before the
  // appointment confirmation below so the two arrive in the order they were
  // discussed.
  if (customMessage) {
    const res = await notifyCustomMessage(
      { id: created.id, name: created.name, phone: created.phone },
      customMessage,
    ).catch(() => null);
    await addEvent(session, created.id, "custom_message_sent", { delivered: Boolean(res?.ok) });
  }

  // A booked estimate goes to the customer in writing. Everything else about
  // this lead was agreed out loud on the call and needs no text, but an
  // appointment does: they have to put it somewhere, and "some time Tuesday"
  // remembered from a phone call is how a crew arrives to an empty house.
  if (created.visit_date) {
    await notifyVisitBooked({
      id: created.id,
      name: created.name,
      phone: created.phone,
      address: created.address,
      visit_date: created.visit_date,
      visit_time: created.visit_time,
    }).catch(() => {});
  }

  revalidatePath("/crm");
  revalidatePath("/crm/calendar");
  return { ok: true, id: created.id };
}
