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
  // Who each appointment belongs to. Read from the staff table rather than
  // carried on the quote, so a contractor who changes their name changes it
  // everywhere at once. A contractor's own RLS only shows them themselves,
  // which is right: their calendar is all theirs anyway.
  const names = staffNameMap(staff);
  const events: CalEvent[] = [];
  for (const q of quotes) {
    // Enough on each event to act without opening the job: the panel shows the
    // phone and address so you can call or navigate straight from the calendar.
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
    // Booked work day = a job install (only ever set once a customer accepts).
    if (q.scheduled_date) {
      events.push({ ...common, date: q.scheduled_date, kind: "job", time: q.scheduled_time });
    }
    // An in-person quote visit: a real slot with a drive attached.
    const visitDate = visitDateOf(q);
    if (visitDate) {
      events.push({ ...common, date: visitDate, kind: "inperson", time: q.visit_time });
    }
    // The slot an online customer offered in case photos aren't enough to price
    // the job. It used to be left off the calendar on the grounds that a card on
    // a day tells the crew to be somewhere and nobody is going anywhere - true,
    // but it meant the one appointment somebody still has to answer was the one
    // appointment you couldn't see. It shows now, faded and labelled Not booked,
    // and it is the only kind you cannot drag: nothing here is agreed yet, so
    // there is nothing to reschedule and nobody to text about it.
    //
    // Only while it is still an open question. Once the job is booked, or the
    // lead is lost or finished, the slot the customer offered weeks ago is not
    // something anybody still has to answer - and a faded card that can never
    // be actioned is the kind of thing people learn to look past, taking the
    // live ones with it.
    const requested = requestedVisitOf(q);
    const stillOpen =
      !q.scheduled_date && q.status !== "lost" && q.status !== "completed" && q.status !== "paid";
    if (requested && stillOpen) {
      events.push({ ...common, date: requested, kind: "online", time: q.visit_time });
    }
  }

  // Everyone who could be on this calendar, plus anyone actually on it - a
  // deactivated contractor still has last month's jobs and still needs a name
  // and a colour against them.
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

      {/* One line rather than a card. Google sync is set up once and then never
          thought about again, so it shouldn't take the top third of the page
          above the thing you actually came here to look at. */}
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

      {/* The roster, not just the people who happen to have something booked:
          an empty week for somebody is worth being able to see, and the legend
          is how a colour becomes a name. */}
      <CalendarView events={events} crew={crew} base={base} locale={locale} />
    </main>
  );
}
