// Plain-English rendering of the activity log. Shared by the job detail page
// and the Security dashboard so both describe an event the same way.
import { STATUS_LABELS } from "./constants";
import type { QuoteEvent } from "./types";

const statusLabel = (v: unknown) => STATUS_LABELS[String(v) as keyof typeof STATUS_LABELS] ?? String(v ?? "N/A");

// Who triggered the event: a named teammate, the customer, or an automatic change.
export function eventActor(e: QuoteEvent, names: Map<string, string>): string {
  if (e.actor) return names.get(e.actor) ?? "A teammate";
  if (e.type.startsWith("customer_")) return "Customer";
  return "Automatic";
}

// Audit-friendly description of what happened.
export function eventText(e: QuoteEvent, names: Map<string, string>): string {
  const m = (e.meta ?? {}) as Record<string, unknown>;
  switch (e.type) {
    case "status_changed":
      return `Status: ${statusLabel(m.from)} → ${statusLabel(m.to)}`;
    case "assigned":
      return m.to ? `Assigned to ${names.get(String(m.to)) ?? "a contractor"}` : "Unassigned";
    case "amount_changed":
      return `Price set to ${m.to != null ? `$${Number(m.to).toLocaleString("en-US")}` : "(cleared)"}`;
    case "summary_changed":
      return "Customer description updated";
    case "notes_changed":
      return "Internal notes updated";
    case "quote_sent":
      return "Quote sent to the customer";
    case "customer_viewed":
      return "Customer opened their quote";
    case "customer_accepted":
      return `Customer accepted${m.scheduled_date ? `, booked ${String(m.scheduled_date)}` : ""}${m.discount ? " ($150 credit)" : ""}`;
    case "customer_declined":
      return "Customer declined the quote";
    case "reminder_sent":
      return "Confirmation reminder texted to the customer";
    case "customer_confirmed":
      return "Customer confirmed their job";
    case "customer_unconfirmed":
      return "Customer could not confirm their job";
    case "job_completed":
      return "Work marked completed";
    case "payment_requested":
      return "Payment instructions texted to the customer";
    case "job_paid":
      return `Marked paid${m.amount != null ? ` ($${Number(m.amount).toLocaleString("en-US")})` : ""}`;
    case "links_rotated":
      return "Customer/job links regenerated (old links disabled)";
    default:
      return e.type.replace(/_/g, " ");
  }
}
