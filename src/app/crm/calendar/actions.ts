"use server";

import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/crm/auth";
import { clearGoogleToken, removeQuoteFromCalendar, syncQuoteToCalendar } from "@/lib/crm/gcal";
import {
  notifyBookingCancelled,
  notifyVisitCancelled,
  notifyVisitMoved,
} from "@/lib/crm/notify";
import { addEvent, clearAppointment, getQuote, getStaffById, rescheduleVisit } from "@/lib/crm/queries";
import { setJobDate } from "@/app/crm/quotes/[id]/actions";

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

// Move an appointment to another day (and optionally another time). Dragging a
// chip onto a cell and using the panel's date picker both land here.
//
// A booked WORK DAY is delegated to setJobDate rather than reimplemented: that
// action already texts the customer that the date moved, tells the crew, logs
// it and updates Google Calendar. Two code paths for "the job moved" is exactly
// how a message ends up going out from one screen but not the other.
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
      ? { ok: true, message: result.message ?? "Job moved and the customer was texted." }
      : { ok: false, error: result.error };
  }

  // Quote visit (in-person or online).
  const time = String(formData.get("time") ?? "").slice(0, 12);
  const current = await getQuote(session, id);
  if (!current) return { ok: false, error: "You don't have access to this quote." };

  const result = await rescheduleVisit(session, id, date, time);
  if (!result.ok) return { ok: false, error: result.error ?? "Could not move that visit." };
  if (result.unchanged) return { ok: true, message: "That was already the visit time." };

  await addEvent(session, id, "visit_moved", {
    from: result.previous ?? null,
    from_time: result.previousTime ?? null,
    to: date,
    to_time: time || null,
  });

  // The office moving a visit from the month grid is precisely when whoever has
  // to drive to it needs telling - they aren't looking at this screen.
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
    { crewPhone: crew?.phone ?? null, crewName: crew?.full_name ?? null, movedBy: session.staff.full_name },
  ).catch(() => {});
  await syncQuoteToCalendar(id);

  refresh(id);
  return { ok: true, message: "Visit moved. The customer and the crew were texted." };
}

// Take the appointment off the calendar. The lead itself is untouched: this is
// "cancel the appointment", not "delete the customer". Deleting a lead outright
// is still the pipeline's Delete, which archives it and can be undone.
export async function deleteEvent(_prev: CalActionState, formData: FormData): Promise<CalActionState> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Your session expired. Please sign in again." };

  const id = String(formData.get("id") ?? "");
  const kind = String(formData.get("kind") ?? "") === "job" ? "job" : "visit";
  // Whether to tell the customer. Defaults to yes - they're expecting us.
  const notify = String(formData.get("notify") ?? "yes") !== "no";
  if (!id) return { ok: false, error: "Missing appointment." };

  const current = await getQuote(session, id);
  if (!current) return { ok: false, error: "You don't have access to this quote." };

  const result = await clearAppointment(session, id, kind);
  if (!result.ok) return { ok: false, error: result.error ?? "Could not remove that appointment." };

  await addEvent(session, id, kind === "job" ? "booking_cancelled" : "visit_cancelled", {
    from: result.previous ?? null,
    from_time: result.previousTime ?? null,
    notified: notify,
  });

  if (notify) {
    const info = { id, name: current.name, phone: current.phone, visit_date: result.previous, visit_time: result.previousTime };
    if (kind === "job") await notifyBookingCancelled(info, result.previous, result.previousTime).catch(() => {});
    else await notifyVisitCancelled(info).catch(() => {});
  }

  await removeQuoteFromCalendar(id);

  refresh(id);
  return {
    ok: true,
    message:
      kind === "job"
        ? `Date released. ${current.name} is back in Needs scheduling${notify ? " and was texted." : "."}`
        : `Visit removed${notify ? " and the customer was texted." : "."}`,
  };
}
