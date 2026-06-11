// Plain constants safe to import from client components (no secrets here).

// Flat "stay with us" credit offered when a customer goes to decline a quote.
export const DECLINE_CREDIT = 150;

export const STATUSES = ["new", "quoted", "booked", "confirmed", "complete", "lost"] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<Status, string> = {
  new: "New",
  quoted: "Quoted",
  booked: "Booked",
  confirmed: "Confirmed",
  complete: "Complete",
  lost: "Lost",
};
