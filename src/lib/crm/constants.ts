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

// How many days before a booked job the crew gets a reminder text. 0 is the
// morning of. The daily cron fires ~10am ET, so the morning-of text still lands
// before a typical start time.
export const CREW_REMINDER_DAYS = [3, 1, 0];
