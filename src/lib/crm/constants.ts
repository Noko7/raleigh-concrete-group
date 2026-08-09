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
// Four days is the floor for the crew to actually get it scheduled - the
// customer picks from there, and the crew confirms one of their days.
export const MAX_PREFERRED_DATES = 3;
export const LEAD_TIME_DAYS = 4;
