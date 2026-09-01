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
    // A corrected quote sent to a customer who hadn't answered the first one.
    // Both figures are on the line, because "did the price move, and by how
    // much" is the only question anyone opens this row to answer.
    case "quote_revised": {
      const money = (v: unknown) => (v != null ? `$${Number(v).toLocaleString("en-US")}` : "no price");
      return m.from !== m.to
        ? `Corrected quote sent to the customer (was ${money(m.from)}, now ${money(m.to)})`
        : "Corrected quote sent to the customer (wording changed)";
    }
    case "quote_delivery":
      return m.delivered
        ? `Quote link texted to ${String(m.to ?? "the customer")}`
        : `Quote text FAILED to ${String(m.to ?? "the customer")}${m.error ? ` — ${String(m.error)}` : ""}`;
    case "customer_viewed":
      return "Customer opened their quote";
    case "customer_accepted": {
      const picks = Array.isArray(m.preferred_dates) ? (m.preferred_dates as string[]) : [];
      const wanted = picks.length ? `, prefers ${picks.join(", ")}` : "";
      return `Customer approved the quote${wanted}${m.discount ? " ($150 credit)" : ""}`;
    }
    case "date_confirmed":
      return `Work day confirmed for ${String(m.to ?? "a date")}${m.to_time ? ` at ${String(m.to_time)}` : ""}`;
    case "date_changed":
      return `Work day moved${m.from ? ` from ${String(m.from)}${m.from_time ? ` ${String(m.from_time)}` : ""}` : ""} to ${String(m.to ?? "a new date")}${m.to_time ? ` at ${String(m.to_time)}` : ""}`;
    case "visit_confirmed": {
      const when = `${String(m.to ?? "a date")}${m.to_time ? ` at ${String(m.to_time)}` : ""}`;
      // Worth recording when the crew didn't take the slot the customer offered:
      // it's the difference between "we agreed" and "we told them a new time".
      const asked =
        m.moved && m.requested
          ? ` (customer had asked for ${String(m.requested)}${m.requested_time ? ` at ${String(m.requested_time)}` : ""})`
          : "";
      return `Quote visit confirmed for ${when}${asked}`;
    }
    case "visit_moved":
      return `Quote visit moved${m.from ? ` from ${String(m.from)}${m.from_time ? ` ${String(m.from_time)}` : ""}` : ""} to ${String(m.to ?? "a new date")}${m.to_time ? ` at ${String(m.to_time)}` : ""}`;
    case "visit_cancelled":
      return `Quote visit cancelled${m.from ? ` (was ${String(m.from)}${m.from_time ? ` ${String(m.from_time)}` : ""})` : ""}${m.notified ? ", customer texted" : ""}`;
    case "booking_cancelled":
      return `Work day released${m.from ? ` (was ${String(m.from)}${m.from_time ? ` ${String(m.from_time)}` : ""})` : ""}${m.notified ? ", customer texted" : ""}`;
    case "customer_declined":
      return "Customer declined the quote";
    case "reminder_sent":
      return "Confirmation reminder texted to the customer";
    case "crew_reminded": {
      const d = Number(m.days_out);
      const when = d === 0 ? "morning of" : d === 1 ? "day before" : `${d} days out`;
      return m.delivered
        ? `Crew reminder texted (${when})`
        : `Crew reminder FAILED (${when}) to ${String(m.to ?? "the crew")}`;
    }
    case "customer_confirmed":
      return "Customer confirmed their job";
    case "customer_unconfirmed":
      return "Customer could not confirm their job";
    case "job_completed": {
      const checks = Array.isArray(m.checks) ? (m.checks as string[]).length : 0;
      const done = checks ? ` (${checks}/3 checked)` : "";
      return `Work marked completed${done}${m.note ? ` - "${String(m.note)}"` : ""}`;
    }
    case "photos_added": {
      const kind = String(m.kind ?? "");
      const label = kind === "before" ? "before" : kind === "after" ? "after" : "site";
      return `Added ${Number(m.count ?? 0)} ${label} photo(s)`;
    }
    case "name_changed":
      return `Customer name corrected to ${String(m.to ?? "")}`;
    case "custom_message_sent":
      return m.delivered ? "Custom text sent to the customer" : "Custom text FAILED to send";
    case "payment_requested":
      return "Payment instructions texted to the customer";
    case "job_paid":
      return `Marked paid${m.amount != null ? ` ($${Number(m.amount).toLocaleString("en-US")})` : ""}`;
    case "links_rotated":
      return "Customer/job links regenerated (old links disabled)";
    case "quote_created_manually":
      return `Lead logged by staff${m.by ? ` (${String(m.by)})` : ""}`;
    default:
      return e.type.replace(/_/g, " ");
  }
}
