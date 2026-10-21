"use server";

import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/crm/auth";
import { clearGoogleToken, syncQuoteToCalendar } from "@/lib/crm/gcal";
import { notifyVisitMoved } from "@/lib/crm/notify";
import { addEvent, getQuote, getStaffById, rescheduleVisit } from "@/lib/crm/queries";
import { cancelAppointment, confirmVisit, setJobDate } from "@/app/crm/quotes/[id]/schedule-actions";

export type CalActionState = { ok: boolean; error?: string; message?: string };

export async function disconnectGoogle(): Promise<void> {
  const session = await getSession();
  if (!session || session.staff.role !== "owner") return;
  await clearGoogleToken();
  revalidatePath("/crm/calendar");
}

function refresh(id: string) {
  revalidatePath("/crm/calendar");
  revalidatePath("/crm");
  revalidatePath(`/crm/quotes/${id}`);
  revalidatePath("/job/[token]", "page");
}

// Drag-and-drop and the panel's date picker both land here. Work days delegate to setJobDate, which
// already texts the customer and crew, logs and updates Google Calendar; one path for "the job moved".
export async function moveEvent(_prev: CalActionState, formData: FormData): Promise<CalActionState> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Your session expired. Please sign in again." };

  const id = String(formData.get("id") ?? "");
  const kind = String(formData.get("kind") ?? "");
  const date = String(formData.get("date") ?? "").slice(0, 10);
  if (!id) return { ok: false, error: "Missing appointment." };

  if (kind === "job") {
    const result = await setJobDate({ ok: false }, formData);
    return result.ok
      ? { ok: true, message: result.message ?? "Job moved." }
      : { ok: false, error: result.error };
  }

  // Unticked when the customer already knows. A drag sends no field, which means yes.
  const tellCustomer = String(formData.get("notify") ?? "yes") !== "no";

  // Quote visit (in-person or online).
  const time = String(formData.get("time") ?? "").slice(0, 12);
  const current = await getQuote(session, id);
  if (!current) return { ok: false, error: "You don't have access to this quote." };

  // A customer's suggested slot isn't booked yet; saving a time here books it.
  if (current.quote_type === "online") {
    const booked = await confirmVisit({ ok: false }, formData);
    return booked.ok ? { ok: true, message: booked.message } : { ok: false, error: booked.error };
  }

  const result = await rescheduleVisit(session, id, date, time);
  if (!result.ok) return { ok: false, error: result.error ?? "Could not move that visit." };
  if (result.unchanged) return { ok: true, message: "That was already the visit time." };

  await addEvent(session, id, "visit_moved", {
    from: result.previous ?? null,
    from_time: result.previousTime ?? null,
    to: date,
    to_time: time || null,
    notified: tellCustomer,
  });

  // Whoever drives to the visit isn't looking at this screen, so tell them.
  const crew = current.assigned_to ? await getStaffById(session, current.assigned_to) : null;
  await notifyVisitMoved(
    {
      id,
      name: current.name,
      phone: current.phone,
      service: current.service,
      address: current.address,
      visit_date: date,
      visit_time: time || null,
      job_token: current.job_token,
    },
    result.previous,
    result.previousTime,
    {
      crewPhone: crew?.phone ?? null,
      crewName: crew?.full_name ?? null,
      movedBy: session.staff.full_name,
      actorPhone: session.staff.phone,
      tellCustomer,
    },
  ).catch(() => {});
  await syncQuoteToCalendar(id);

  refresh(id);
  return {
    ok: true,
    message: tellCustomer
      ? "Visit moved. The customer and the crew were texted."
      : "Visit moved. The crew was told; the customer was not texted.",
  };
}

// Cancels the appointment only; the lead is untouched (Delete in the pipeline archives it).
export async function deleteEvent(_prev: CalActionState, formData: FormData): Promise<CalActionState> {
  // Delegated like moveEvent: cancelAppointment clears the date, logs, texts the customer and removes the
  // Google event.
  return cancelAppointment({ ok: false }, formData);
}
