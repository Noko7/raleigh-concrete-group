import { requireSession } from "@/lib/crm/auth";
import { googleConfigured, googleStatus } from "@/lib/crm/gcal";
import { crmBase } from "@/lib/crm/nav";
import { listScheduled } from "@/lib/crm/queries";
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
  const { google } = await searchParams;

  const quotes = await listScheduled(session);
  const events: CalEvent[] = [];
  for (const q of quotes) {
    const label = q.name || "Customer";
    // Booked work day = a job install (only ever set once a customer accepts).
    if (q.scheduled_date) {
      events.push({ id: q.id, date: q.scheduled_date, kind: "job", title: label, time: null });
    }
    // The appointment the customer picked: an on-site visit (in-person) or a
    // remote photo review (online). Color them separately so the day reads clearly.
    if (q.visit_date) {
      events.push({
        id: q.id,
        date: q.visit_date,
        kind: q.quote_type === "online" ? "online" : "inperson",
        title: label,
        time: q.visit_time,
      });
    }
  }

  const status = isOwner ? await googleStatus() : { connected: false };
  const configured = googleConfigured();
  const notice = google ? NOTICES[google] : undefined;

  return (
    <main className="crm-page">
      <div className="crm-page-head">
        <div>
          <h1>Calendar</h1>
          <p className="crm-muted">
            Job installs, in-person quotes and online quotes, color-coded. Tap a color below to filter; click any item
            to open the deal.
          </p>
        </div>
      </div>

      {notice && <div className={`crm-banner crm-banner-${notice.tone}`}>{notice.text}</div>}

      {isOwner && (
        <div className="crm-card cal-gcal">
          <div className="cal-gcal-main">
            <h2 className="crm-card-title">Google Calendar</h2>
            {!configured ? (
              <p className="crm-muted crm-sm">
                Add <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code> and{" "}
                <code>GOOGLE_REDIRECT_URI</code> in Vercel, then reload to connect.
              </p>
            ) : status.connected ? (
              <p className="crm-muted crm-sm">
                Connected{status.email ? ` as ${status.email}` : ""}. When a job is booked or you assign a contractor to a
                dated job, everyone gets a Google Calendar invite.
              </p>
            ) : (
              <p className="crm-muted crm-sm">
                Connect your Google account so booked jobs and assigned visits send calendar invites to your crew.
              </p>
            )}
          </div>
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
      )}

      <CalendarView events={events} base={base} />
    </main>
  );
}
