// The quote funnel: what a visitor does between opening the quote form and
// sending it, recorded so the office can see where people give up.
//
// Shared by the browser (which sends events), /api/funnel (which checks them)
// and the CRM's Funnel page (which adds them up). Nothing in here is personal:
// no name, phone, email or address ever goes into an event, only which step
// someone was on, how long they spent on it, and which requirement was still
// unmet when they left. An attempt is identified by a random id minted when the
// form opens, and nothing ties that id to the lead it may turn into.
//
// Why not Vercel Analytics: custom events are a Pro-plan feature, and this is
// on Hobby. Supabase is already paid for (free tier) and already here.

// The quote modal's screens, in order. "choice" is online vs in-person.
export const FUNNEL_STEPS = ["choice", "contact", "service", "schedule"] as const;
export type FunnelStep = (typeof FUNNEL_STEPS)[number];

// open    the form was opened (path = the page it was opened from)
// view    a step was shown
// done    a step was completed with Continue (ms = time spent on it)
// back    Back was pressed on a step (ms = time spent on it)
// close   the form was dismissed before sending (detail = what was unfinished)
// error   something told them no (detail = what)
// submit  the lead was saved (ms = open to saved)
export const FUNNEL_EVENTS = ["open", "view", "done", "back", "close", "error", "submit"] as const;
export type FunnelEventName = (typeof FUNNEL_EVENTS)[number];

// The Get Free Quote pop-up. (There was also a standalone /estimate page; it
// was retired on 23 Sep, and anything still claiming to be from it is dropped.)
export const FUNNEL_FORMS = ["modal"] as const;
export type FunnelForm = (typeof FUNNEL_FORMS)[number];

export type FunnelEvent = {
  attempt_id: string;
  visitor_id: string;
  form: FunnelForm;
  event: FunnelEventName;
  step: FunnelStep | null;
  ms: number | null;
  mode: "online" | "inperson" | null;
  detail: string | null;
  path: string | null;
  device: "mobile" | "desktop";
};

// Routes whose second path segment is a secret (a customer's quote link, a
// contractor's invite). The pages themselves are private, but the quote button
// is site-wide, so an event could still be sent from one: the token is cut out
// here before it goes anywhere. Keep in step with vercel-insights.tsx.
const TOKEN_ROUTES = new Set(["q", "job", "confirm", "join", "pay"]);

export function scrubPath(pathname: string): string {
  const parts = pathname.split("?")[0].split("#")[0].split("/");
  if (TOKEN_ROUTES.has(parts[1] ?? "") && parts[2]) parts[2] = "[token]";
  return parts.join("/").slice(0, 200) || "/";
}

// A browser can send anything, so every field is re-checked on the way in and
// anything unrecognised is dropped rather than stored. Returns null to discard.
const ID_RE = /^[a-z0-9-]{8,40}$/i;
const DETAIL_RE = /^[a-z0-9_+:,.-]{1,120}$/i;
const STEP_SET = new Set<string>(FUNNEL_STEPS);

export function parseFunnelEvent(raw: unknown): FunnelEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");

  const attempt_id = str(r.attempt_id);
  const visitor_id = str(r.visitor_id);
  if (!ID_RE.test(attempt_id) || !ID_RE.test(visitor_id)) return null;

  const form = str(r.form) as FunnelForm;
  const event = str(r.event) as FunnelEventName;
  if (!FUNNEL_FORMS.includes(form) || !FUNNEL_EVENTS.includes(event)) return null;

  const stepRaw = str(r.step);
  const step = STEP_SET.has(stepRaw) ? (stepRaw as FunnelEvent["step"]) : null;

  // A tab left open overnight is not a 14-hour step. Cap at an hour; the
  // stats use medians, so the odd long one doesn't drag the figure anyway.
  const msNum = typeof r.ms === "number" && Number.isFinite(r.ms) ? Math.round(r.ms) : null;
  const ms = msNum === null || msNum < 0 ? null : Math.min(msNum, 60 * 60 * 1000);

  const modeRaw = str(r.mode);
  const mode = modeRaw === "online" || modeRaw === "inperson" ? modeRaw : null;

  const detailRaw = str(r.detail);
  const detail = DETAIL_RE.test(detailRaw) ? detailRaw : null;

  const pathRaw = str(r.path);
  const path = pathRaw.startsWith("/") ? scrubPath(pathRaw) : null;

  const device = str(r.device) === "mobile" ? "mobile" : "desktop";

  return { attempt_id, visitor_id, form, event, step, ms, mode, detail, path, device };
}
