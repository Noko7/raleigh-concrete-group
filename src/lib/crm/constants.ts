// Plain constants safe to import from client components (no secrets here).

// Flat "stay with us" credit offered when a customer goes to decline a quote.
export const DECLINE_CREDIT = 150;

// Pipeline a job moves through, lead -> money:
//   New      a fresh lead, no quote sent yet
//   Quoted   price + summary sent, waiting on the customer
//   Scheduled customer accepted and a work day is on the calendar
//   Completed work is done on site
//   Paid     money received (Zelle / deposit) - the end of the line
//   Lost     declined or dead
export const STATUSES = ["new", "quoted", "scheduled", "completed", "paid", "lost"] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<Status, string> = {
  new: "New",
  quoted: "Quoted",
  scheduled: "Scheduled",
  completed: "Completed",
  paid: "Paid",
  lost: "Lost",
};
