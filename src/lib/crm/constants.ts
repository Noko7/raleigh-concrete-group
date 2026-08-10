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

// The visit slots offered on the public quote form. Shared with the server so a
// tampered form can't book "3:00 AM"; both sides check the same list.
export const VISIT_TIME_SLOTS = ["8:00 AM", "10:00 AM", "12:00 PM", "2:00 PM", "4:00 PM"];

// visit_date carries two different meanings and quote_type is what tells them
// apart. Everything that shows a date to a person goes through one of these two
// readers rather than the column, because the difference between "we are coming"
// and "we might come" is the whole thing.
type Visitable = { quote_type?: string | null; visit_date?: string | null };

// A booked appointment: somebody is expected at an address on this day. Only an
// in-person row has one. This is what the calendar, Google invites, crew
// reminders and the job page's headline date are all built on.
export function visitDateOf(q: Visitable): string | null {
  return q.quote_type === "online" ? null : (q.visit_date ?? null);
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
