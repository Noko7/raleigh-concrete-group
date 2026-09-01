// Plain-English names for the message log's `kind` column. Same arrangement as
// STATUS_LABELS: the stored value is a stable key written by the server at send
// time, and this is the only place it becomes something a person reads.
//
// A kind with no entry here falls back to its raw key rather than disappearing,
// so adding a notification and forgetting this file degrades to "crew_reminder_3"
// on screen instead of a blank row.
export const MESSAGE_LABELS: Record<string, string> = {
  new_quote: "New lead alert",
  new_quote_crew: "New lead - crew brief",
  received: "Request received",
  visit_confirmed: "Quote visit confirmed",
  visit_booked: "Estimate booked on a call",
  custom: "Custom text from the office",
  visit_reminder: "Quote visit reminder",
  stale_lead: "Untouched lead nudge",
  stale_lead_digest: "Untouched leads - daily list",
  quote_followup: "48h quote follow-up",
  quote_ready: "Quote sent",
  quote_updated: "Updated quote sent",
  quote_sent: "Quote-sent alert",
  approved: "Approval thank-you",
  needs_scheduling: "Approved - needs a date",
  scheduled: "Work day confirmed",
  rescheduled: "Work day moved",
  visit_moved: "Quote visit moved",
  visit_cancelled: "Quote visit cancelled",
  booking_cancelled: "Work day released",
  booked: "Job booked",
  declined: "Quote declined",
  reminder: "Please-confirm reminder",
  unconfirmed: "Customer could not confirm",
  crew_reminder_3: "Crew reminder - 3 days out",
  crew_reminder_1: "Crew reminder - day before",
  crew_reminder_0: "Crew reminder - morning of",
  complete: "Job complete thank-you",
  payment_request: "Payment instructions",
  assignment: "Assigned to crew",
};

export function messageLabel(kind: string): string {
  return MESSAGE_LABELS[kind] ?? kind.replace(/_/g, " ");
}

export const ROLE_LABELS: Record<string, string> = {
  customer: "Customer",
  owner: "You",
  crew: "Crew",
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}
