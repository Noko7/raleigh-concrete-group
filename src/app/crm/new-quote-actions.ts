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
  insertQuoteResult,
  resolveAssignee,
} from "@/lib/crm/queries";
import type { Quote } from "@/lib/crm/types";

export type NewQuoteState = { ok: boolean; error?: string; id?: string };
// Same check as /api/quote. The DB's qr_chk validates it too, but this gives a
// real error instead of "could not save".
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// A lead logged from a phone call. Only name and phone are required (qr_chk).
// Owner-only, here and by RLS (manual-quote.sql): contractors work leads, they
// don't create them. Auto-assigns like the public form. Doesn't send the
// web-submission receipt: staff are on the phone with the customer.
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

  // An in-person call-in books the estimate on the call. quote_type "inperson"
  // makes visit_date a real appointment rather than an offered slot.
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
    // How the lead came in; the public form stamps its page path here.
    source_path: "crm:manual",
  };

  // An explicit pick beats the job-type rules (commercial work often belongs to
  // a specific person).
  const pickedAssignee = String(formData.get("assigned_to") ?? "").trim();
  if (pickedAssignee && !/^[0-9a-fA-F-]{36}$/.test(pickedAssignee)) {
    return { ok: false, error: "Pick a valid contractor." };
  }
  const assigneeId = pickedAssignee || (await resolveAssignee(service).catch(() => null));

  // Check before writing, so the office can offer another time while still on the call.
  if (assigneeId && visitDate && visitTime) {
    const clash = await findVisitConflict(assigneeId, visitDate, visitTime);
    if (clash) return { ok: false, error: conflictMessage(clash) };
  }

  if (assigneeId) row.assigned_to = assigneeId;

  const result = await insertQuoteResult(session, row);
  const created = result.quote;
  if (!created) {
    // On a "From plans" lead, a check violation means qr_chk doesn't know the
    // type yet (quote-type-plans.sql); every other field was validated above.
    if (result.code === "23514" && quoteType === "plans") {
      return {
        ok: false,
        error: 'The database does not know the "From plans" quote type yet. Run supabase/quote-type-plans.sql in Supabase, then try again.',
      };
    }
    return { ok: false, error: result.error ?? "Could not save the lead. Please try again." };
  }

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

  // What the office promised on the call, in writing, sent before the
  // appointment text so they arrive in the order discussed.
  if (customMessage) {
    const res = await notifyCustomMessage(
      { id: created.id, name: created.name, phone: created.phone },
      customMessage,
    ).catch(() => null);
    // Evening texts are held until 8am; the log records which happened.
    await addEvent(session, created.id, "custom_message_sent", {
      delivered: Boolean(res?.ok),
      held_until: res?.sendAfter ?? null,
    });
  }

  // A booked estimate gets a text: they need it written down somewhere, or the
  // crew arrive at an empty house.
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
