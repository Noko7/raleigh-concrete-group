// Plain constants safe to import from client components (no secrets here).
export const STATUSES = ["new", "assigned", "quoted", "sent", "viewed", "won", "lost"] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<Status, string> = {
  new: "New",
  assigned: "Assigned",
  quoted: "Quoted",
  sent: "Sent to Customer",
  viewed: "Viewed by Customer",
  won: "Won",
  lost: "Lost",
};
