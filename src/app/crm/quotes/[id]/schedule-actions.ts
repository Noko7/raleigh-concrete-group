"use server";

import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/crm/auth";
import { todayYmd } from "@/lib/crm/clock";
import {
  TIME_RE,
  optionAmount,
  optionsTotal,
  visitDateOf,
} from "@/lib/crm/constants";
import { removeQuoteFromCalendar, syncQuoteToCalendar } from "@/lib/crm/gcal";
import {
  notifyApprovalRecorded,
  notifyBooked,
  notifyBookingCancelled,
  notifyCustomerRescheduled,
  notifyCustomerScheduled,
  notifyOfflineApproval,
  notifyVisitCancelled,
  notifyVisitConfirmed,
  notifyVisitMoved,
} from "@/lib/crm/notify";
import {
  addEvent,
  clearAppointment,
  confirmSchedule,
  conflictMessage,
  countJobsOn,
  findJobConflict,
  findVisitConflict,
  getQuote,
  getStaffById,
  MAX_JOBS_PER_DAY,
  recordOfflineAcceptance,
  updateQuoteResult,
  type OptionChoice,
} from "@/lib/crm/queries";
import type { ScheduleState } from "./types";

// Confirm or move the work day: the action that turns an approved job into a
// booked one (texts customer and crew, syncs the calendar). Contractors may run
// it for their own jobs (RLS in confirmSchedule).
export async function setJobDate(_prev: ScheduleState, formData: FormData): Promise<ScheduleState> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Your session expired. Please sign in again." };

  const id = String(formData.get("id") ?? "");
  const date = String(formData.get("date") ?? "").slice(0, 10);
  const time = String(formData.get("time") ?? "").slice(0, 10);
  if (!id) return { ok: false, error: "Missing job id." };

  // Only consulted when a booked day MOVES. "no" means the office already told
  // the customer. Absent (calendar drag, older form) means yes.
  const tellCustomer = String(formData.get("notify") ?? "yes") !== "no";

  const current = await getQuote(session, id);
  if (!current) return { ok: false, error: "You don't have access to this job." };

  const result = await confirmSchedule(session, id, date, time);
  if (!result.ok) return { ok: false, error: result.error ?? "Could not save that date." };
  if (result.unchanged) return { ok: true, message: "That date and time were already set." };

  const moved = Boolean(result.previous);
  await addEvent(session, id, moved ? "date_changed" : "date_confirmed", {
    from: result.previous ?? null,
    from_time: result.previousTime ?? null,
    to: date,
    to_time: time,
    ...(moved ? { notified: tellCustomer } : {}),
  });

  const info = {
    id,
    name: current.name,
    phone: current.phone,
    service: current.service,
    address: current.address,
    quote_amount: current.quote_amount,
    scheduled_date: date,
    scheduled_time: time,
    job_token: current.job_token,
  };

  const contractor = current.assigned_to ? await getStaffById(session, current.assigned_to) : null;
  if (moved) {
    if (tellCustomer) await notifyCustomerRescheduled(info, result.previous, result.previousTime).catch(() => {});
  } else await notifyCustomerScheduled(info).catch(() => {});
  await notifyBooked(info, contractor?.phone, result.previous, result.previousTime, session.staff.phone).catch(
    () => {},
  );
  await syncQuoteToCalendar(id);

  revalidatePath(`/crm/quotes/${id}`);
  revalidatePath("/crm");
  revalidatePath("/crm/calendar");
  // The contractor's job page schedules through this too.
  revalidatePath("/job/[token]", "page");
  return {
    ok: true,
    message: !moved
      ? "Date confirmed and customer texted."
      : tellCustomer
        ? "Date changed and everyone notified."
        : "Date changed. The crew was told; the customer was not texted.",
  };
}

// The customer said yes on the phone, often with a day too.
//
// Everything after approval waits on customer_response = "accepted". Without
// this the crew must chase a button press, or resend the quote, whose date
// picker starts LEAD_TIME_DAYS out, past the day already agreed.
//
// Records the approval as staff (who and how) and books the agreed day in the
// same submit, so the booking isn't forgotten. The lead-time floor deliberately
// doesn't apply: it limits what a customer requests unprompted, and the person
// entering this has just checked the crew's week. Any day from today.
export async function acceptOffline(_prev: ScheduleState, formData: FormData): Promise<ScheduleState> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Your session expired. Please sign in again." };

  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing quote id." };
  const date = String(formData.get("date") ?? "").slice(0, 10);
  const time = String(formData.get("time") ?? "").slice(0, 10);
  const booking = /^\d{4}-\d{2}-\d{2}$/.test(date);
  // "no" = they're still on the phone or asked not to be texted. Approval and
  // booking are recorded either way; this only controls the customer text.
  const tellCustomer = String(formData.get("notify") ?? "yes") !== "no";

  const current = await getQuote(session, id);
  if (!current) return { ok: false, error: "You don't have access to this quote." };

  // Optional-line answers, in the option builder's JSON shape. Only uuid keys
  // with a real answer survive.
  const choices: Record<string, OptionChoice> = {};
  try {
    const raw = JSON.parse(String(formData.get("options") ?? "{}")) as Record<string, unknown>;
    for (const [key, value] of Object.entries(raw)) {
      if (!/^[0-9a-f-]{36}$/i.test(key)) continue;
      if (value === "accepted" || value === "declined") choices[key] = value;
    }
  } catch {
    return { ok: false, error: "Could not read the line item answers. Reload the page and try again." };
  }

  // Check the day BEFORE writing the approval: to the user it's one action, and
  // a clash found afterwards would leave it approved with the error lost.
  if (booking) {
    if (!TIME_RE.test(time.trim())) return { ok: false, error: "Pick the start time you agreed on." };
    if (date < todayYmd()) return { ok: false, error: "That day has already passed. Pick today or later." };
    if ((await countJobsOn(date, id)) >= MAX_JOBS_PER_DAY) {
      return { ok: false, error: "Another job is already booked that day. Record the approval without a date, or agree another day." };
    }
    const clash = await findJobConflict(current.assigned_to, date, id);
    if (clash) return { ok: false, error: conflictMessage(clash) };
  }

  // Package id, if a choice was offered; refused downstream if missing. No default.
  const packageId = String(formData.get("package") ?? "").trim();

  const recorded = await recordOfflineAcceptance(session, id, {
    options: choices,
    packageId: /^[0-9a-f-]{36}$/i.test(packageId) ? packageId : undefined,
    agreedDate: booking ? date : null,
    agreedTime: booking ? time : null,
  });
  if (!recorded.ok) return { ok: false, error: recorded.error ?? "Could not record that approval." };

  // The chosen package leads the list: "approved - $8,500" doesn't say what to
  // load the truck with.
  const pick = recorded.package;
  const chosen = {
    accepted: [
      ...(pick ? [{ title: pick.title, amount: optionAmount(pick) }] : []),
      ...(recorded.accepted ?? []).map((o) => ({ title: o.title, amount: optionAmount(o) })),
    ],
    declined: (recorded.declined ?? []).map((o) => ({ title: o.title, amount: optionAmount(o) })),
  };
  // The row's new figure (package/options may reprice it), quoted in every message below.
  const amount =
    pick || (recorded.accepted && recorded.accepted.length > 0)
      ? Math.round(
          ((pick ? optionAmount(pick) : 0) + optionsTotal(recorded.accepted ?? [])) * 100,
        ) / 100
      : current.quote_amount;

  await addEvent(session, id, "customer_accepted", {
    // Marks it as staff-recorded from a call, so the activity log never claims
    // the customer clicked.
    channel: "phone",
    recorded_by: session.staff.full_name || session.staff.email || "Staff",
    preferred_dates: booking ? [date] : null,
    preferred_times: booking ? [time] : null,
    chosen_package: pick?.title ?? null,
    accepted_options: (recorded.accepted ?? []).map((o) => o.title),
    declined_options: (recorded.declined ?? []).map((o) => o.title),
    total: amount ?? null,
  });

  const contractor = current.assigned_to ? await getStaffById(session, current.assigned_to) : null;
  const info = {
    id,
    name: current.name,
    phone: current.phone,
    service: current.service,
    address: current.address,
    quote_amount: amount,
    job_token: current.job_token,
    public_token: current.public_token,
    preferred_dates: booking ? [date] : null,
    preferred_times: booking ? [time] : null,
    chosen,
  };

  let booked = false;
  // Why the requested day didn't take. Conflicts were ruled out up front, so
  // this is the DB refusing; the crew must hear it with "approval recorded".
  let bookingError: string | null = null;
  const withDate = { ...info, scheduled_date: booking ? date : null, scheduled_time: booking ? time : null };
  if (booking) {
    // Same call as the schedule card, so texts, calendar and reminders match.
    const result = await confirmSchedule(session, id, date, time);
    if (result.ok && !result.unchanged) {
      booked = true;
      await addEvent(session, id, "date_confirmed", { from: null, from_time: null, to: date, to_time: time });
      if (tellCustomer) await notifyCustomerScheduled(withDate).catch(() => {});
      await notifyBooked(withDate, contractor?.phone, null, null, session.staff.phone).catch(() => {});
      await syncQuoteToCalendar(id);
    } else if (!result.ok) {
      bookingError = result.error ?? "the date could not be saved";
    }
  }

  // The office always hears it came by phone, even when booked too: JOB BOOKED
  // alone reads like the customer tapped the link.
  await notifyOfflineApproval(booked ? withDate : info, contractor?.phone, {
    recordedBy: session.staff.full_name || session.staff.email || "a teammate",
    actorPhone: session.staff.phone,
    booked,
  }).catch(() => {});

  // Skipped when booked: notifyCustomerScheduled covered both halves.
  if (tellCustomer && !booked) await notifyApprovalRecorded(info).catch(() => {});

  revalidatePath(`/crm/quotes/${id}`);
  revalidatePath("/crm");
  revalidatePath("/crm/calendar");
  revalidatePath("/job/[token]", "page");

  // Never an error (the approval is written), but a requested day that didn't
  // book must be said where the user is looking.
  if (bookingError) {
    return { ok: true, message: `Approval recorded, but the day was NOT booked: ${bookingError} Set it on the schedule card below.` };
  }
  const texted = tellCustomer ? " The customer has been texted." : "";
  return {
    ok: true,
    message: booked
      ? `Approval recorded and the day is booked.${texted}`
      : `Approval recorded and the job is ready to schedule.${texted}`,
  };
}

// An online request carries a slot the customer offered in case photos aren't
// enough; this is the crew taking it up. It flips the request to in-person,
// which is the point: calendar, invites, reminders and the job page key off
// quote_type to decide whether a date means someone is expected.
export async function confirmVisit(_prev: ScheduleState, formData: FormData): Promise<ScheduleState> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Your session expired. Please sign in again." };

  const id = String(formData.get("id") ?? "");
  const date = String(formData.get("date") ?? "").slice(0, 10);
  const rawTime = String(formData.get("time") ?? "").slice(0, 20);
  if (!id) return { ok: false, error: "Missing job id." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "Pick a date for the visit." };
  // Any well-formed time, not the public form's slot list: the crew fit visits
  // around a real day. Normalised like confirmSchedule so "9:00 am" and
  // "9:00 AM" don't diverge.
  if (!TIME_RE.test(rawTime)) return { ok: false, error: "Pick a time for the visit." };
  const time = rawTime.trim().toUpperCase().replace(/\s+/, " ");
  // Only for moving an existing visit (see setJobDate); a first confirmation
  // always texts, since that's how they find out.
  const tellCustomer = String(formData.get("notify") ?? "yes") !== "no";

  const current = await getQuote(session, id);
  if (!current) return { ok: false, error: "You don't have access to this job." };

  // The assignee must actually be free; this is when an offered slot becomes a
  // commitment. No per-day cap (visits stack an hour apart), and the crew
  // aren't held to their Settings window here.
  const clash = await findVisitConflict(current.assigned_to, date, time, id);
  if (clash) return { ok: false, error: conflictMessage(clash) };

  const wasOnline = current.quote_type === "online";
  // Did they already have an appointment? An online row's date was only
  // offered, so only in-person counts. Confirming introduces the visit; moving
  // says only what changed, so a reschedule doesn't read as a second booking.
  const hadAppointment = Boolean(visitDateOf(current));
  const movedOff = current.visit_date !== date || (current.visit_time ?? "") !== time;

  // Re-confirming the same slot isn't news; nobody is texted.
  if (hadAppointment && !movedOff) {
    return { ok: true, message: "That was already the visit day and time. Nobody was texted." };
  }

  const { quote: updated, error } = await updateQuoteResult(session, id, {
    quote_type: "inperson",
    visit_date: date,
    visit_time: time,
    // Re-arm night-before reminders, as confirmSchedule does for work days.
    visit_reminder_sent_at: null,
    visit_crew_reminded_at: null,
  });
  if (!updated) return { ok: false, error: error ?? "Could not confirm that visit." };

  await addEvent(session, id, hadAppointment ? "visit_moved" : "visit_confirmed", {
    to: date,
    to_time: time,
    ...(hadAppointment
      ? { from: current.visit_date ?? null, from_time: current.visit_time ?? null, notified: tellCustomer }
      : { requested: current.visit_date ?? null, requested_time: current.visit_time ?? null, moved: movedOff }),
  });

  // The assignee is texted, not whoever clicked (same person only on the job page).
  const crew = current.assigned_to ? await getStaffById(session, current.assigned_to) : null;
  const info = {
    id,
    name: current.name,
    phone: current.phone,
    service: current.service,
    address: current.address,
    quote_type: "inperson",
    visit_date: date,
    visit_time: time,
    job_token: current.job_token,
  };

  if (hadAppointment) {
    // Only what changed. Crew and office are told too, since the calendar can
    // move a visit out from under the driver.
    await notifyVisitMoved(info, current.visit_date, current.visit_time, {
      crewPhone: crew?.phone ?? null,
      crewName: crew?.full_name ?? null,
      movedBy: session.staff.full_name,
      actorPhone: session.staff.phone,
      tellCustomer,
    }).catch(() => {});
  } else {
    await notifyVisitConfirmed(
      info,
      // Nobody assigned, nobody to tell; the owner alert covers it.
      crew?.phone ?? null,
      crew?.full_name ?? session.staff.full_name,
      // What they asked for, so the text can own up to a different slot.
      { date: current.visit_date, time: current.visit_time },
      // Read before the update flipped it: an online conversion is a different story.
      wasOnline,
      session.staff.phone,
    ).catch(() => {});
  }
  await syncQuoteToCalendar(id);

  revalidatePath(`/crm/quotes/${id}`);
  revalidatePath("/crm");
  revalidatePath("/crm/calendar");
  revalidatePath("/job/[token]", "page");
  return {
    ok: true,
    message: hadAppointment
      ? tellCustomer
        ? "Visit moved. The customer has been texted the new day, and so has the crew."
        : "Visit moved. The crew was told; the customer was not texted."
      : movedOff
        ? "Visit confirmed for the new day. The customer and the crew have been texted."
        : "Visit confirmed. The customer and the crew have been texted.",
  };
}

/**
 * Call off an appointment (work day or quote visit), not the lead. A work day
 * drops back to Needs scheduling; a visit's date is cleared. Removing the lead
 * is the pipeline's Delete (archive, undoable).
 *
 * `notify` defaults on: usually we can't make it and they expect us. Off when
 * the customer asked and you're on the phone with them.
 *
 * One shared action for all three screens, so no cancel path forgets to text.
 */
export async function cancelAppointment(_prev: ScheduleState, formData: FormData): Promise<ScheduleState> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Your session expired. Please sign in again." };

  const id = String(formData.get("id") ?? "");
  const kind = String(formData.get("kind") ?? "") === "job" ? "job" : "visit";
  const notify = String(formData.get("notify") ?? "yes") !== "no";
  // Whether the CUSTOMER asked: receipt vs apology, and the reason in the crew's copy.
  const asked = String(formData.get("asked") ?? "") === "yes";
  if (!id) return { ok: false, error: "Missing appointment." };

  const current = await getQuote(session, id);
  if (!current) return { ok: false, error: "You don't have access to this job." };

  // Nothing booked usually means a double cancel or a stale page; not an error.
  const had = kind === "job" ? current.scheduled_date : visitDateOf(current);
  if (!had) return { ok: true, message: "That appointment was already cancelled. Nobody was texted." };

  const result = await clearAppointment(session, id, kind);
  if (!result.ok) return { ok: false, error: result.error ?? "Could not cancel that appointment." };

  await addEvent(session, id, kind === "job" ? "booking_cancelled" : "visit_cancelled", {
    from: result.previous ?? null,
    from_time: result.previousTime ?? null,
    notified: notify,
  });

  // The crew hears either way; `notify` only concerns the customer.
  const crew = current.assigned_to ? await getStaffById(session, current.assigned_to) : null;
  const info = {
    id,
    name: current.name,
    phone: current.phone,
    service: current.service,
    address: current.address,
    visit_date: result.previous,
    visit_time: result.previousTime,
    job_token: current.job_token,
  };
  const team = {
    asked,
    tellCustomer: notify,
    crewPhone: crew?.phone ?? null,
    cancelledBy: session.staff.full_name,
    actorPhone: session.staff.phone,
  };

  if (kind === "job") await notifyBookingCancelled(info, result.previous, result.previousTime, team).catch(() => {});
  else await notifyVisitCancelled(info, team).catch(() => {});

  await removeQuoteFromCalendar(id);

  revalidatePath(`/crm/quotes/${id}`);
  revalidatePath("/crm");
  revalidatePath("/crm/calendar");
  revalidatePath("/job/[token]", "page");
  return {
    ok: true,
    message:
      kind === "job"
        ? `Date released. ${current.name} is back in Needs scheduling${notify ? " and was texted." : "."}`
        : `Visit cancelled${notify ? " and the customer was texted." : "."}`,
  };
}
