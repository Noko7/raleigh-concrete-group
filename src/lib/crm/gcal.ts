// Server-only Google Calendar integration. No SDK - just fetch() against
// Google's OAuth + Calendar REST endpoints so nothing needs to be installed.
//
// Flow: the owner connects their Google account once (OAuth, offline access).
// We store the refresh token in public.app_integrations (service-role only).
// When a job is booked or a contractor is assigned to a dated job/visit, we
// create or update an event on the owner's primary calendar with the contractor
// (and customer, if we have their email) as attendees and sendUpdates=all, so
// Google emails everyone a real calendar invite.
//
// Required env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI.
import { visitDateOf } from "./constants";
import { pgAdmin } from "./rest";
import type { Quote } from "./types";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
export const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || "";
const TZ = process.env.GOOGLE_CALENDAR_TZ || "America/New_York";

const SCOPE = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

const CAL_BASE = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

export function googleConfigured(): boolean {
  return Boolean(CLIENT_ID && CLIENT_SECRET && GOOGLE_REDIRECT_URI);
}

// ── Token storage (app_integrations, provider='google') ─────────────────────
type GoogleToken = { refresh_token: string; email?: string };

async function loadToken(): Promise<GoogleToken | null> {
  const res = await pgAdmin("app_integrations?provider=eq.google&select=data&limit=1");
  if (!res.ok) return null;
  const rows = (await res.json()) as { data: GoogleToken }[];
  const d = rows[0]?.data;
  return d?.refresh_token ? d : null;
}

async function saveToken(data: GoogleToken): Promise<void> {
  await pgAdmin("app_integrations", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ provider: "google", data, updated_at: new Date().toISOString() }),
  });
}

export async function clearGoogleToken(): Promise<void> {
  await pgAdmin("app_integrations?provider=eq.google", {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
}

export async function googleStatus(): Promise<{ connected: boolean; email?: string }> {
  const t = await loadToken();
  return { connected: Boolean(t), email: t?.email };
}

// ── OAuth ───────────────────────────────────────────────────────────────────
export function googleAuthUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

// Exchange the one-time code for tokens and persist the refresh token.
export async function exchangeAndStore(code: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("[gcal] code exchange failed", res.status, detail);
    return { ok: false, error: "Google rejected the connection. Check your client ID, secret and redirect URI." };
  }
  const json = (await res.json()) as { refresh_token?: string; access_token?: string };
  if (!json.refresh_token) {
    // No refresh token means Google didn't grant offline access (often because
    // the app was already authorized). prompt=consent should force it.
    return { ok: false, error: "Google didn't return a refresh token. Remove the app's access in your Google account and try connecting again." };
  }
  let email: string | undefined;
  if (json.access_token) {
    const who = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${json.access_token}` },
    }).catch(() => null);
    if (who?.ok) email = ((await who.json()) as { email?: string }).email;
  }
  await saveToken({ refresh_token: json.refresh_token, email });
  return { ok: true };
}

async function accessToken(): Promise<string | null> {
  const t = await loadToken();
  if (!t) return null;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: t.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    console.error("[gcal] refresh failed", res.status, await res.text().catch(() => ""));
    return null;
  }
  return (((await res.json()) as { access_token?: string }).access_token) ?? null;
}

// ── Event building ──────────────────────────────────────────────────────────
type GAttendee = { email: string };
type GDate = { date?: string; dateTime?: string; timeZone?: string };
type GEvent = {
  summary: string;
  description?: string;
  location?: string;
  start: GDate;
  end: GDate;
  attendees?: GAttendee[];
};

// How long a booked job blocks the calendar for, in hours. A concrete job is a
// day's work; this keeps the slot from looking free at 10am.
const JOB_HOURS = 8;

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// "2:00 PM" -> { h: 14, m: 0 }. Returns null if it can't parse.
function parseClock(s: string | null): { h: number; m: number } | null {
  if (!s) return null;
  const m = s.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ap = m[3]?.toUpperCase();
  if (ap === "PM" && h < 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return { h, m: min };
}

function describe(q: Quote, isVisit: boolean): string {
  const lines = [
    `${isVisit ? "In-person quote visit" : "Booked concrete job"} for ${q.name}.`,
    q.phone ? `Phone: ${q.phone}` : "",
    q.service ? `Service: ${q.service}` : "",
    q.address ? `Address: ${q.address}` : "",
    q.quote_amount != null ? `Quote: $${Number(q.quote_amount).toLocaleString("en-US")}` : "",
    isVisit && q.visit_time ? `Requested time: ${q.visit_time}` : "",
    !isVisit && q.scheduled_time ? `Start time: ${q.scheduled_time}` : "",
    q.details ? `\nProject notes: ${q.details}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

function buildEvent(q: Quote, attendees: GAttendee[]): GEvent | null {
  const base = { attendees: attendees.length ? attendees : undefined };

  // A booked work day takes precedence. Timed when the crew picked a start
  // time, so the calendar agrees with what the customer was told; all-day only
  // for older bookings made before start times existed.
  if (q.scheduled_date) {
    const job = {
      ...base,
      summary: `Concrete job: ${q.name}`,
      description: describe(q, false),
      location: q.address ?? undefined,
    };
    const clock = parseClock(q.scheduled_time);
    if (clock) {
      const hh = String(clock.h).padStart(2, "0");
      const mm = String(clock.m).padStart(2, "0");
      // Blocks the working day from the start time, so nothing else gets
      // booked on top of a crew that's already out on a pour.
      const endH = String(Math.min(clock.h + JOB_HOURS, 23)).padStart(2, "0");
      return {
        ...job,
        start: { dateTime: `${q.scheduled_date}T${hh}:${mm}:00`, timeZone: TZ },
        end: { dateTime: `${q.scheduled_date}T${endH}:${mm}:00`, timeZone: TZ },
      };
    }
    return {
      ...job,
      start: { date: q.scheduled_date },
      end: { date: addDays(q.scheduled_date, 1) },
    };
  }

  // Otherwise an in-person quote visit (timed if we can read the time slot).
  // Online quotes never produce an event even if the row carries a date: an
  // invite on the crew's calendar means somebody is expected to be somewhere.
  const visitDate = visitDateOf(q);
  if (visitDate) {
    const clock = parseClock(q.visit_time);
    if (clock) {
      const hh = String(clock.h).padStart(2, "0");
      const mm = String(clock.m).padStart(2, "0");
      const start = `${visitDate}T${hh}:${mm}:00`;
      const endH = String((clock.h + 1) % 24).padStart(2, "0");
      const end = `${visitDate}T${endH}:${mm}:00`;
      return {
        ...base,
        summary: `In-person quote: ${q.name}`,
        description: describe(q, true),
        location: q.address ?? undefined,
        start: { dateTime: start, timeZone: TZ },
        end: { dateTime: end, timeZone: TZ },
      };
    }
    return {
      ...base,
      summary: `In-person quote: ${q.name}`,
      description: describe(q, true),
      location: q.address ?? undefined,
      start: { date: visitDate },
      end: { date: addDays(visitDate, 1) },
    };
  }

  return null;
}

async function staffEmail(id: string): Promise<string | null> {
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) return null;
  const res = await pgAdmin(`staff?id=eq.${id}&select=email&limit=1`);
  if (!res.ok) return null;
  const rows = (await res.json()) as { email: string | null }[];
  return rows[0]?.email ?? null;
}

// Pull a quote's event off the calendar. Used when an appointment is deleted in
// the CRM: without this the invite lingers on everyone's calendar and the crew
// shows up to a job that isn't happening. Best-effort - never throws.
export async function removeQuoteFromCalendar(quoteId: string): Promise<void> {
  try {
    if (!googleConfigured()) return;
    const res = await pgAdmin(`quote_requests?id=eq.${encodeURIComponent(quoteId)}&select=gcal_event_id&limit=1`);
    if (!res.ok) return;
    const eventId = ((await res.json()) as { gcal_event_id: string | null }[])[0]?.gcal_event_id;
    if (!eventId) return;

    const token = await accessToken();
    if (token) {
      // 404/410 means it's already gone, which is the state we wanted anyway.
      const del = await fetch(`${CAL_BASE}/${encodeURIComponent(eventId)}?sendUpdates=all`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!del.ok && del.status !== 404 && del.status !== 410) {
        console.error("[gcal] delete failed", del.status, await del.text().catch(() => ""));
      }
    }

    // Clear the id regardless: a stale id would make the next booking try to
    // PATCH an event that no longer exists.
    await pgAdmin(`quote_requests?id=eq.${encodeURIComponent(quoteId)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ gcal_event_id: null }),
    });
  } catch (e) {
    console.error("[gcal] remove threw", e);
  }
}

// Create or update the calendar invite for a quote. Idempotent: stores the
// Google event id on the quote so subsequent calls update the same event (and
// invite any newly-assigned contractor). Best-effort - never throws.
export async function syncQuoteToCalendar(quoteId: string): Promise<void> {
  try {
    if (!googleConfigured()) return;
    const token = await accessToken();
    if (!token) return; // not connected

    const res = await pgAdmin(`quote_requests?id=eq.${encodeURIComponent(quoteId)}&select=*&limit=1`);
    if (!res.ok) return;
    const q = ((await res.json()) as Quote[])[0];
    if (!q) return;

    const attendees: GAttendee[] = [];
    if (q.assigned_to) {
      const email = await staffEmail(q.assigned_to);
      if (email) attendees.push({ email });
    }
    if (q.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q.email)) attendees.push({ email: q.email });

    const event = buildEvent(q, attendees);
    if (!event) return; // nothing dated to sync

    const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

    if (q.gcal_event_id) {
      const upd = await fetch(`${CAL_BASE}/${encodeURIComponent(q.gcal_event_id)}?sendUpdates=all`, {
        method: "PATCH",
        headers: auth,
        body: JSON.stringify(event),
      });
      if (upd.ok) return;
      if (upd.status !== 404 && upd.status !== 410) {
        console.error("[gcal] update failed", upd.status, await upd.text().catch(() => ""));
        return;
      }
      // 404/410: event was deleted in Google - fall through and recreate.
    }

    const created = await fetch(`${CAL_BASE}?sendUpdates=all`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify(event),
    });
    if (!created.ok) {
      console.error("[gcal] create failed", created.status, await created.text().catch(() => ""));
      return;
    }
    const ev = (await created.json()) as { id?: string };
    if (ev.id) {
      await pgAdmin(`quote_requests?id=eq.${encodeURIComponent(quoteId)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ gcal_event_id: ev.id }),
      });
    }
  } catch (e) {
    console.error("[gcal] sync threw", e);
  }
}
