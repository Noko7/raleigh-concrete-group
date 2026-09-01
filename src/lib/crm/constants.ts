// Plain constants safe to import from client components (no secrets here).

// Flat "stay with us" credit offered when a customer goes to decline a quote.
export const DECLINE_CREDIT = 150;

// Pipeline a job moves through, lead -> money:
//   New       a fresh lead, no quote sent yet
//   Quoted    price + summary sent, waiting on the customer
//   Approved  customer said yes and gave preferred days - needs a confirmed date
//   Scheduled a work day is confirmed and on the calendar
//   Completed work is done on site
//   Paid      money received (Zelle / deposit) - the end of the line
//   Lost      declined or dead
export const STATUSES = ["new", "quoted", "approved", "scheduled", "completed", "paid", "lost"] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<Status, string> = {
  new: "New",
  quoted: "Quoted",
  approved: "Needs scheduling",
  scheduled: "Scheduled",
  completed: "Completed",
  paid: "Paid",
  lost: "Lost",
};

// How many days the customer may propose, and how far out the earliest is.
// Seven days is the floor for a customer-requested install day: it's long
// enough to line up crew and materials before committing to anything.
export const MAX_PREFERRED_DATES = 3;
export const LEAD_TIME_DAYS = 7;

// Earliest an in-person quote VISIT can be requested. Shorter than the install
// lead time on purpose - a visit is one person for an hour, not a crew and a
// truck, so it can happen sooner.
export const VISIT_LEAD_DAYS = 4;

// The visit slots offered on the PUBLIC quote form only. Shared with the
// server so a tampered form can't book "3:00 AM"; both sides check the same
// list. A contractor confirming a visit from the job page isn't held to this
// list - they need to fit a visit around a real day, not five fixed slots -
// so confirmVisit validates against TIME_RE instead.
export const VISIT_TIME_SLOTS = ["8:00 AM", "10:00 AM", "12:00 PM", "2:00 PM", "4:00 PM"];

// The shape every stored time string is in: "H:MM AM/PM", e.g. "9:00 AM" or
// "2:15 PM". Not tied to any particular list of slots - this is what
// scheduled_time/visit_time actually validate against once a contractor is
// free to pick anything, and what SMS/CRM/calendar code already assumes.
export const TIME_RE = /^\d{1,2}:\d{2}\s?(AM|PM)$/i;

// Converts a native <input type="time"> value (24h "HH:MM") to the "H:MM
// AM/PM" string above.
export function to12Hour(hhmm: string): string {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return hhmm;
  const h24 = Number(m[1]);
  const ap = h24 >= 12 ? "PM" : "AM";
  const h = h24 % 12 || 12;
  return `${h}:${m[2]} ${ap}`;
}
// The reverse, for handing that same input its current value.
export function to24Hour(t: string, fallback = "09:00"): string {
  const m = t.trim().match(/^(\d{1,2}):(\d{2})\s?(AM|PM)$/i);
  if (!m) return fallback;
  let h = Number(m[1]) % 12;
  if (m[3].toUpperCase() === "PM") h += 12;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

// Every quote answers the same five questions, in this order. A concrete
// quote that skips permits or says nothing about cleanup is where disputes
// start, so the shape is fixed rather than left to whoever is typing.
//
// Order matters: it is the order the customer reads them on their quote page
// and the order they appear in both editors.
export const QUOTE_SECTION_FIELDS = [
  "quote_scope",
  "quote_permits",
  "quote_prep",
  "quote_pour",
  "quote_cleanup",
] as const;
export type QuoteSectionField = (typeof QUOTE_SECTION_FIELDS)[number];

export const QUOTE_SECTION_LABELS: Record<QuoteSectionField, string> = {
  quote_scope: "Scope",
  quote_permits: "Permits",
  quote_prep: "Demolition and prep",
  quote_pour: "Pour and finish",
  quote_cleanup: "Clean up",
};

// What each section is for, shown as placeholder text so the answer lands in
// the right box. Kept short: these are read on a phone on a job site.
export const QUOTE_SECTION_HINTS: Record<QuoteSectionField, string> = {
  quote_scope: "What we're building, the size, and the finish.",
  quote_permits: "Who pulls them, what they cost, or Not applicable.",
  quote_prep: "What comes out, what gets hauled away, how the base is built.",
  quote_pour: "Depth, reinforcement, concrete mix, and the finish.",
  quote_cleanup: "How the site is left, and when.",
};

// A sent quote link is good for a week. Long enough for a customer to think
// it over and talk to a partner, short enough that our price isn't held open
// while material costs move.
export const QUOTE_TTL_DAYS = 7;

// No em dashes in anything a customer reads.
//
// Applied to every outbound text and to the quote body on save, rather than
// left to whoever is typing. An em dash is the tell that copy was not written
// by the person sending it, it renders inconsistently across handsets, and
// nobody types one on a phone anyway. A spaced hyphen says the same thing.
//
// Also folds the en dash, and the "--" people type meaning an em dash.
export function noEmDash(s: string): string {
  return s
    .replace(/\s*[—–]\s*/g, " - ")
    .replace(/\s--\s/g, " - ");
}

// How we are pricing a job, which decides whether anybody goes to look at it.
//
//   inperson  we drive out and measure. The only kind with a real appointment.
//   online    priced from the customer's photos. They offer a fallback slot in
//             case the photos aren't enough; nobody is committed to it.
//   plans     priced from drawings - the commercial case, an apartment block
//             or a slab schedule. No visit and no photos.
//
// null is a row from before this column existed. Those were all site visits,
// so null is treated as in-person throughout.
export const QUOTE_TYPES = ["inperson", "online", "plans"] as const;
export type QuoteType = (typeof QUOTE_TYPES)[number];

export const QUOTE_TYPE_LABELS: Record<QuoteType, string> = {
  inperson: "In person",
  online: "Online (photos)",
  plans: "From plans",
};

// visit_date carries two different meanings and quote_type is what tells them
// apart. Everything that shows a date to a person goes through one of these two
// readers rather than the column, because the difference between "we are coming"
// and "we might come" is the whole thing.
type Visitable = { quote_type?: string | null; visit_date?: string | null };

// A booked appointment: somebody is expected at an address on this day. Only an
// in-person row has one. This is what the calendar, Google invites, crew
// reminders and the job page's headline date are all built on.
//
// Written as an allow-list, not "anything except online". The old form was
// correct while there were exactly two types, and quietly wrong the moment a
// third arrived: a 'plans' row would have claimed a visit nobody booked, put
// a commercial job on the calendar, and sent a crew a night-before reminder
// to drive to an apartment site for an appointment that never existed.
export function visitDateOf(q: Visitable): string | null {
  const booked = q.quote_type === "inperson" || q.quote_type == null;
  return booked ? (q.visit_date ?? null) : null;
}

// The slot an online customer offered in case their job turns out to be too big
// to price from photos. It is an option, not a commitment - nobody drives
// anywhere on it, and the customer has been told we'll text to confirm first.
// A contractor confirming it is what turns the request in-person, at which point
// it stops being readable here and becomes a real visit above.
export function requestedVisitOf(q: Visitable): string | null {
  return q.quote_type === "online" ? (q.visit_date ?? null) : null;
}

// How many days before a booked job the crew gets a reminder text. 0 is the
// morning of. The daily cron fires ~10am ET, so the morning-of text still lands
// before a typical start time.
export const CREW_REMINDER_DAYS = [3, 1, 0];

// Anything to do with what time it is lives in ./clock - the business's zone,
// today's date, quiet hours. It's imported from client components too, same as
// this file.
