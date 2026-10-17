import { requireSession } from "@/lib/crm/auth";
import { requestedVisitOf, visitDateOf } from "@/lib/crm/constants";
import { dict, isLocale } from "@/lib/crm/i18n";
import { googleConfigured, googleStatus } from "@/lib/crm/gcal";
import { crmBase } from "@/lib/crm/nav";
import { listScheduled, listStaff, staffNameMap } from "@/lib/crm/queries";
import { CalendarView, type CalEvent } from "./calendar-view";
import { disconnectGoogle } from "./actions";

export const dynamic = "force-dynamic";

const NOTICES: Record<string, { tone: "ok" | "warn"; text: string }> = {
  connected: { tone: "ok", text: "Google Calendar connected. New bookings and assignments will send calendar invites." },
  error: { tone: "warn", text: "Couldn't finish connecting to Google. Please try again." },
  denied: { tone: "warn", text: "Google connection was cancelled." },
  badstate: { tone: "warn", text: "Connection expired. Please try connecting again." },
  unconfigured: { tone: "warn", text: "Google isn't configured yet. Add the Google env vars in Vercel first." },
};

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string }>;
}) {
  const session = await requireSession();
  const base = await crmBase();
  const isOwner = session.staff.role === "owner";
  const rawLocale = session.staff.locale;
  const locale = isLocale(rawLocale) ? rawLocale : "en";
  const t = dict(locale);
  const { google } = await searchParams;

  const [quotes, staff] = await Promise.all([listScheduled(session), listStaff(session)]);
  // From the staff table so a rename applies everywhere. Contractor RLS shows only themselves.
  const names = staffNameMap(staff);
  const events: CalEvent[] = [];
  for (const q of quotes) {
    // Phone and address on each event so you can call or navigate straight from the calendar.
    const common = {
      id: q.id,
      title: q.name || "Customer",
      phone: q.phone,
      service: q.service,
      address: q.address,
      status: q.status,
      assignedTo: q.assigned_to ?? null,
      assignedName: q.assigned_to ? (names.get(q.assigned_to) ?? null) : null,
    };
    // Booked work day (only set once a customer accepts).
    if (q.scheduled_date) {
      events.push({ ...common, date: q.scheduled_date, kind: "job", time: q.scheduled_time });
    }
    // In-person quote visit.
    const visitDate = visitDateOf(q);
    if (visitDate) {
      events.push({ ...common, date: visitDate, kind: "inperson", time: q.visit_time });
    }
    // An online customer's fallback slot: shown faded as "Not booked", and not draggable (nothing is agreed,
    // so nothing to reschedule). Only while still an open question: never on booked, lost or finished jobs.
    const requested = requestedVisitOf(q);
    const stillOpen =
      !q.scheduled_date && q.status !== "lost" && q.status !== "completed" && q.status !== "paid";
    if (requested && stillOpen) {
      events.push({ ...common, date: requested, kind: "online", time: q.visit_time });
    }
  }

  // Plus anyone on the calendar: a deactivated contractor's past jobs still need a name and colour.
  const crew = [
    ...staff.filter((s) => s.role === "contractor" && s.active),
    ...staff.filter((s) => !(s.role === "contractor" && s.active) && events.some((e) => e.assignedTo === s.id)),
  ].map((s) => ({ id: s.id, name: names.get(s.id) ?? "Staff" }));

  const status = isOwner ? await googleStatus() : { connected: false };
  const configured = googleConfigured();
  const notice = google ? NOTICES[google] : undefined;

  return (
    <main className="crm-page">
      <div className="crm-page-head">
        <div>
          <h1>{t.calendar.title}</h1>
          <p className="crm-muted">{t.calendar.subtitle}</p>
        </div>
      </div>

      {notice && <div className={`crm-banner crm-banner-${notice.tone}`}>{notice.text}</div>}

      {/* One line, not a card: Google sync is set up once. */}
      {isOwner && (
        <details className="cal-gcal" open={!status.connected && configured}>
          <summary>
            <span className={`cal-gcal-dot${status.connected ? " cal-gcal-on" : ""}`} />
            Google Calendar
            <em>
              {!configured
                ? "not configured"
                : status.connected
                  ? `connected${status.email ? ` as ${status.email}` : ""}`
                  : "not connected"}
            </em>
          </summary>
          <div className="cal-gcal-body">
            {!configured ? (
              <p className="crm-muted crm-sm">
                Add <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code> and{" "}
                <code>GOOGLE_REDIRECT_URI</code> in Vercel, then reload to connect.
              </p>
            ) : status.connected ? (
              <p className="crm-muted crm-sm">
                When a job is booked or you assign a contractor to a dated job, everyone gets a Google Calendar invite.
              </p>
            ) : (
              <p className="crm-muted crm-sm">
                Connect your Google account so booked jobs and assigned visits send calendar invites to your crew.
              </p>
            )}
            {configured && (
              <div className="cal-gcal-action">
                {status.connected ? (
                  <form action={disconnectGoogle}>
                    <button type="submit" className="crm-btn crm-btn-ghost">
                      Disconnect
                    </button>
                  </form>
                ) : (
                  <a href={`${base}/api/google/connect`} className="crm-btn crm-btn-primary">
                    Connect Google Calendar
                  </a>
                )}
              </div>
            )}
          </div>
        </details>
      )}

      {/* The full roster, so an empty week is visible and every colour has a name. */}
      <CalendarView events={events} crew={crew} base={base} locale={locale} />
    </main>
  );
}
