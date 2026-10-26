// Server-only CRM data access: booking capacity, double-booking and appointments. Re-exported from ../queries.ts.
import {
  DEFAULT_WORK_HOURS,
  TIME_RE,
  VISIT_GAP_MINUTES,
  minutesOfTime,
  nearestOpenSlot,
  readWorkHours,
  slotsFor,
  visitDateOf,
  worksOn,
  type WorkHours,
} from "../constants";
import { pgAdmin } from "../rest";
import type { Quote, Session } from "../types";
import { ISO_DATE } from "./shared";
import { getQuote, updateQuoteResult } from "./quotes";
import { clearCrewReminders } from "./reminders";

// ── Booking capacity ────────────────────────────────────────────────────────
// One booked work day per day for the whole business: one crew, one truck.
// Quote visits have no per-day cap; they're limited per contractor by working
// hours and spacing (see visitAvailability).
export const MAX_JOBS_PER_DAY = 1;
const UUID_RE = /^[0-9a-fA-F-]{36}$/;

// Work jobs already booked on a date (accepted, not Lost). Optionally excludes
// one quote so re-accepting doesn't count against itself. Lost is excluded so
// an abandoned booking doesn't block the day forever; the unique index in
// appointments.sql matches.
export async function countJobsOn(date: string, excludeId?: string): Promise<number> {
  if (!ISO_DATE.test(date)) return 0;
  let path = `quote_requests?scheduled_date=eq.${date}&customer_response=eq.accepted&status=neq.lost&select=id`;
  if (excludeId && /^[0-9a-fA-F-]{36}$/.test(excludeId)) path += `&id=neq.${excludeId}`;
  const res = await pgAdmin(path);
  if (!res.ok) return 0;
  return ((await res.json()) as unknown[]).length;
}

// ── Double-booking: one contractor, one place at a time ─────────────────────
// The per-day cap is business-wide; these stop one person being double-booked.
// Every path that commits a date runs one of them first.

export type Commitment = {
  id: string;
  name: string;
  kind: "job" | "visit";
  time: string | null;
};

// Everything one contractor is committed to on a date.
//
// A null staffId is the unassigned pile, treated as one shared calendar:
// routing can fail to pick anyone, and whoever ends up owning two 10am bookings
// is the same person.
//
// Not counted: an online request's visit_date (only an offered slot) and Lost jobs.
export async function contractorCommitments(
  staffId: string | null,
  date: string,
  excludeId?: string,
): Promise<Commitment[]> {
  if (!ISO_DATE.test(date)) return [];
  if (staffId !== null && !UUID_RE.test(staffId)) return [];
  const who = staffId === null ? "assigned_to=is.null" : `assigned_to=eq.${staffId}`;
  const res = await pgAdmin(
    `quote_requests?${who}&status=neq.lost` +
      `&or=(scheduled_date.eq.${date},visit_date.eq.${date})` +
      `&select=id,name,quote_type,customer_response,scheduled_date,scheduled_time,visit_date,visit_time`,
  );
  if (!res.ok) return [];
  const rows = (await res.json()) as {
    id: string;
    name: string;
    quote_type: string | null;
    customer_response: string | null;
    scheduled_date: string | null;
    scheduled_time: string | null;
    visit_date: string | null;
    visit_time: string | null;
  }[];

  const out: Commitment[] = [];
  for (const r of rows) {
    if (excludeId && r.id === excludeId) continue;
    if (r.scheduled_date === date && r.customer_response === "accepted") {
      out.push({ id: r.id, name: r.name, kind: "job", time: r.scheduled_time });
    }
    // visitDateOf's rule: only an in-person (or legacy null) visit is a commitment.
    if (r.visit_date === date && visitDateOf(r)) {
      out.push({ id: r.id, name: r.name, kind: "visit", time: r.visit_time });
    }
  }
  return out;
}

const clockKey = (t?: string | null) => (t ?? "").trim().toUpperCase().replace(/\s+/g, " ");

// Too close on one person's day? Distance between start times (not slot
// overlap), so an odd 9:30 blocks both 9:00 and 10:00. Unparseable times fall
// back to exact string match rather than letting everything through.
function tooClose(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = minutesOfTime(a);
  const y = minutesOfTime(b);
  if (x === null || y === null) return clockKey(a) === clockKey(b);
  return Math.abs(x - y) < VISIT_GAP_MINUTES;
}

// A work day is a full day on site, so anything else on that date blocks it.
// No assignee means nobody to double-book (the per-day cap covers the business).
export async function findJobConflict(
  staffId: string | null | undefined,
  date: string,
  excludeId?: string,
): Promise<Commitment | null> {
  if (!staffId) return null;
  return (await contractorCommitments(staffId, date, excludeId))[0] ?? null;
}

// A visit clashes with another starting within VISIT_GAP_MINUTES, or any work day.
export async function findVisitConflict(
  staffId: string | null | undefined,
  date: string,
  time: string,
  excludeId?: string,
): Promise<Commitment | null> {
  const busy = await contractorCommitments(staffId ?? null, date, excludeId);
  return busy.find((c) => c.kind === "job" || tooClose(c.time, time)) ?? null;
}

// Staff-facing only: names the other customer. Never show to the public.
export function conflictMessage(c: Commitment): string {
  const when = c.time ? ` at ${c.time}` : "";
  return c.kind === "job"
    ? `That crew is already booked on ${c.name}'s job that day${when}. Pick another day, or assign this to someone else first.`
    : `That crew has a quote visit with ${c.name}${when}, and visits need an hour between them. Pick another time, or assign this to someone else first.`;
}

// One contractor's working window; bad or missing values fall back to the default.
export async function getWorkHours(staffId: string | null | undefined): Promise<WorkHours> {
  if (!staffId || !UUID_RE.test(staffId)) return DEFAULT_WORK_HOURS;
  const res = await pgAdmin(`staff?id=eq.${staffId}&select=work_start_hour,work_end_hour,work_days&limit=1`);
  // On a failed read everyone gets the default window.
  if (!res.ok) {
    console.error("[getWorkHours] failed", { staffId, status: res.status });
    return DEFAULT_WORK_HOURS;
  }
  const rows = (await res.json()) as Parameters<typeof readWorkHours>[0][];
  return readWorkHours(rows[0]);
}

/**
 * A contractor's day as seen by someone booking a visit. Times only, never
 * names: the endpoint is public (staff use findVisitConflict).
 *
 *   slots     start times offered that day, from their hours
 *   taken     those within an hour of something booked
 *   wholeDay  on a pour; nothing bookable
 *   works     false if they don't work that weekday
 */
export async function visitAvailability(
  staffId: string | null | undefined,
  date: string,
): Promise<{ slots: string[]; taken: string[]; wholeDay: boolean; works: boolean }> {
  const hours = await getWorkHours(staffId);
  const slots = slotsFor(hours);
  if (!ISO_DATE.test(date)) return { slots, taken: [], wholeDay: false, works: true };
  if (!worksOn(hours, date)) return { slots, taken: slots, wholeDay: false, works: false };

  const busy = await contractorCommitments(staffId ?? null, date);
  if (busy.some((c) => c.kind === "job")) return { slots, taken: slots, wholeDay: true, works: true };

  const taken = slots.filter((s) => busy.some((c) => tooClose(c.time, s)));
  return { slots, taken, wholeDay: false, works: true };
}

// How far ahead the public form will look for an opening before giving up on the calendar.
const NEXT_OPEN_DAYS = 30;

// The first open visit slot on or after `fromDate`, nearest to `nearTime` on the first day that has one.
// The public form books this when the customer's own pick can't be used, so an in-person request always
// leaves with an appointment and nobody has to phone them to set one. Null only if a month is solid.
export async function nextOpenVisit(
  staffId: string | null | undefined,
  fromDate: string,
  nearTime?: string | null,
): Promise<{ date: string; time: string } | null> {
  if (!ISO_DATE.test(fromDate)) return null;
  const start = new Date(`${fromDate}T12:00:00Z`);
  for (let i = 0; i < NEXT_OPEN_DAYS; i++) {
    const date = new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10);
    const { slots, taken, wholeDay, works } = await visitAvailability(staffId, date);
    if (!works || wholeDay) continue;
    const time = nearestOpenSlot(slots, taken, nearTime);
    if (time) return { date, time };
  }
  return null;
}

// Confirm (or move) the work day. Runs as the user, so RLS lets the assigned
// crew book their own jobs. Returns the previous date/time so the caller can
// tell a first booking from a reschedule.
export async function confirmSchedule(
  session: Session,
  id: string,
  date: string,
  time: string,
): Promise<{ ok: boolean; error?: string; previous?: string | null; previousTime?: string | null; unchanged?: boolean }> {
  if (!ISO_DATE.test(date)) return { ok: false, error: "Pick a valid date." };
  // e.g. "9:00 AM"; shape-checked so a tampered form can't inject text into SMS.
  if (!TIME_RE.test(time.trim())) return { ok: false, error: "Pick a start time." };
  const cleanTime = time.trim().toUpperCase().replace(/\s+/, " ");

  const current = await getQuote(session, id);
  if (!current) return { ok: false, error: "You don't have access to this job." };
  // A new time on the same day is still a change the customer must hear about.
  if (current.scheduled_date === date && current.scheduled_time === cleanTime) {
    return { ok: true, previous: date, previousTime: cleanTime, unchanged: true };
  }

  // One job per day; the DB enforces it too, but this gives a clear message.
  if ((await countJobsOn(date, id)) >= MAX_JOBS_PER_DAY) {
    return { ok: false, error: "Another job is already booked that day." };
  }

  // ...and one place at a time for the crew, e.g. a quote visit that day.
  const clash = await findJobConflict(current.assigned_to, date, id);
  if (clash) return { ok: false, error: conflictMessage(clash) };

  const { quote: updated, error } = await updateQuoteResult(session, id, {
    scheduled_date: date,
    scheduled_time: cleanTime,
    status: current.status === "completed" || current.status === "paid" ? current.status : "scheduled",
    scheduled_by: session.staff.id,
    scheduled_at: new Date().toISOString(),
    // A moved date invalidates any confirmation the customer already gave.
    confirmed_at: null,
    reminder_sent_at: null,
  });
  if (!updated) return { ok: false, error: error ?? "Could not save that date. Please try again." };

  // Separate best-effort write: booking must not fail on the reminder column.
  await clearCrewReminders(id);

  return { ok: true, previous: current.scheduled_date, previousTime: current.scheduled_time };
}

// ── Quote visits (the in-person/online appointment, not the work day) ───────
// Separate from confirmSchedule: visits can share a day and moving one never
// touches pipeline status.
export async function rescheduleVisit(
  session: Session,
  id: string,
  date: string,
  time: string,
): Promise<{ ok: boolean; error?: string; previous?: string | null; previousTime?: string | null; unchanged?: boolean }> {
  if (!ISO_DATE.test(date)) return { ok: false, error: "Pick a valid date." };
  const cleanTime = time.trim().toUpperCase().replace(/\s+/, " ");
  if (cleanTime && !TIME_RE.test(cleanTime)) return { ok: false, error: "Pick a valid time." };

  const current = await getQuote(session, id);
  if (!current) return { ok: false, error: "You don't have access to this quote." };
  if (current.visit_date === date && (current.visit_time ?? "") === cleanTime) {
    return { ok: true, previous: date, previousTime: cleanTime, unchanged: true };
  }

  // No per-day cap: visits stack an hour apart per person, and a work day blocks all slots.
  const clash = await findVisitConflict(current.assigned_to, date, cleanTime, id);
  if (clash) return { ok: false, error: conflictMessage(clash) };

  const { quote: updated, error } = await updateQuoteResult(session, id, {
    visit_date: date,
    visit_time: cleanTime || null,
    // Re-arm night-before reminders, or a moved visit is never reminded again.
    visit_reminder_sent_at: null,
    visit_crew_reminded_at: null,
  });
  if (!updated) return { ok: false, error: error ?? "Could not move that visit." };

  return { ok: true, previous: current.visit_date, previousTime: current.visit_time };
}

// Take an appointment off the calendar. A booked job drops back to "approved"
// so it resurfaces in the pipeline instead of sitting dateless in "scheduled".
export async function clearAppointment(
  session: Session,
  id: string,
  kind: "job" | "visit",
): Promise<{ ok: boolean; error?: string; previous?: string | null; previousTime?: string | null }> {
  const current = await getQuote(session, id);
  if (!current) return { ok: false, error: "You don't have access to this quote." };

  const patch: Partial<Quote> =
    kind === "job"
      ? {
          scheduled_date: null,
          scheduled_time: null,
          scheduled_by: null,
          scheduled_at: null,
          confirmed_at: null,
          reminder_sent_at: null,
          status: current.status === "scheduled" ? "approved" : current.status,
        }
      : { visit_date: null, visit_time: null, visit_reminder_sent_at: null, visit_crew_reminded_at: null };

  const { quote: updated, error } = await updateQuoteResult(session, id, patch);
  if (!updated) return { ok: false, error: error ?? "Could not remove that appointment." };

  if (kind === "job") await clearCrewReminders(id);

  return {
    ok: true,
    previous: kind === "job" ? current.scheduled_date : current.visit_date,
    previousTime: kind === "job" ? current.scheduled_time : current.visit_time,
  };
}
