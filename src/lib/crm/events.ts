// Plain-English rendering of the activity log. Shared by the job detail page
// and the Security dashboard so both describe an event the same way.
import { clockLabel } from "./clock";
import { STATUS_LABELS } from "./constants";
import { usd } from "./fees";
import type { QuoteEvent } from "./types";

const statusLabel = (v: unknown) => STATUS_LABELS[String(v) as keyof typeof STATUS_LABELS] ?? String(v ?? "N/A");

// Money in the log is always stored in cents, same as the ledger it came from.
// Named for its unit because the quote_revised case below has its own local
// helper that formats DOLLARS - two "money" functions disagreeing by a factor
// of a hundred is not a bug anyone finds by reading.
const centsUsd = (v: unknown) => (v == null ? "$0.00" : usd(Number(v) || 0));

// When a text held by quiet hours is due, in Raleigh time - "tomorrow at
// 8:00 AM" rather than the ISO stamp the event actually stores.
const heldWhen = (v: unknown) => {
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? "in the morning" : clockLabel(d);
};

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
      // Three outcomes, not two: sent, held for quiet hours, or actually
      // failed. Reading a hold as a failure sends somebody chasing a problem
      // that will resolve itself at 8am.
      if (m.delivered) return `Quote link texted to ${String(m.to ?? "the customer")}`;
      if (m.held_until) return `Quote link queued for ${String(m.to ?? "the customer")} (quiet hours, goes out ${heldWhen(m.held_until)})`;
      return `Quote text FAILED to ${String(m.to ?? "the customer")}${m.error ? ` - ${String(m.error)}` : ""}`;
    case "customer_viewed":
      return "Customer opened their quote";
    // Line items were added, removed, repriced or reordered. The count and the
    // all-in figure are what tell a repriced quote from a reshuffled one.
    case "options_changed": {
      const n = Number(m.count ?? 0);
      const total = m.total != null ? ` ($${Number(m.total).toLocaleString("en-US")} all in)` : "";
      return n === 0 ? "Line items removed - back to a single price" : `Line items updated: ${n} item(s)${total}`;
    }
    case "customer_accepted": {
      const picks = Array.isArray(m.preferred_dates) ? (m.preferred_dates as string[]) : [];
      // The hour they asked for on each day, where the log has one. Older
      // entries recorded days only and still read correctly.
      const at = Array.isArray(m.preferred_times) ? (m.preferred_times as (string | null)[]) : [];
      const asked = picks.map((d, i) => `${d}${at[i] ? ` ${at[i]}` : ""}`);
      const wanted = asked.length ? `, prefers ${asked.join(", ")}` : "";
      // On a quote with options, which ones they took is the whole story - the
      // total alone doesn't say whether the sidewalk is in it.
      const yes = Array.isArray(m.accepted_options) ? (m.accepted_options as string[]) : [];
      const no = Array.isArray(m.declined_options) ? (m.declined_options as string[]) : [];
      const chose = yes.length ? `: took ${yes.join(", ")}${no.length ? `, left ${no.join(", ")}` : ""}` : "";
      return `Customer approved the quote${chose}${wanted}${m.discount ? " ($150 credit)" : ""}`;
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
    case "stale_lead_reminded": {
      // Chased in one text covering every stale lead, so this says which batch
      // it was part of - the text itself is logged without a job id, since it
      // belongs to several.
      const of = Number(m.of);
      return of > 1
        ? `Chased as untouched, in a list of ${of} sent to the crew`
        : "Chased as untouched: nudge texted to the crew";
    }
    case "crew_reminded": {
      const d = Number(m.days_out);
      const when = d === 0 ? "morning of" : d === 1 ? "day before" : `${d} days out`;
      // Three outcomes again: sent, queued behind that person's other texts
      // from the same run, or failed. A spaced reminder that reads as a failure
      // sends somebody chasing a text that is about to arrive.
      if (m.delivered) return `Crew reminder texted (${when})`;
      if (m.queued_for) return `Crew reminder queued for ${String(m.queued_for)} (${when}, spaced out)`;
      return `Crew reminder FAILED (${when}) to ${String(m.to ?? "the crew")}`;
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
      if (m.delivered) return "Custom text sent to the customer";
      if (m.held_until) return `Custom text queued (quiet hours, goes out ${heldWhen(m.held_until)})`;
      return "Custom text FAILED to send";
    case "payment_requested":
      return "Payment instructions texted to the customer";
    case "pay_link_sent":
      return m.delivered
        ? `Card payment link texted to ${String(m.to ?? "the customer")}`
        : `Card payment link FAILED to send${m.error ? ` - ${String(m.error)}` : ""}`;
    // What they said at the moment they approved. Not a commitment - it just
    // tells the crew whether to expect a card or a cheque book.
    case "payment_choice":
      return m.choice === "card"
        ? "Customer chose to pay by card"
        : "Customer chose to pay the crew directly";
    case "payment_received": {
      const how = String(m.method ?? "payment");
      const fee = Number(m.fee_cents ?? 0);
      // The office's cut is on the line because this is the only record that
      // says whether it was collected with the payment or left owed.
      return `${how === "card" ? "Card payment" : `${how.charAt(0).toUpperCase()}${how.slice(1)} recorded`}: ${centsUsd(m.amount_cents)}${
        how === "card" ? ` (fee ${centsUsd(fee)})` : ""
      }`;
    }
    case "payment_refunded":
      return `Refunded ${centsUsd(m.amount_cents)}`;
    case "job_paid":
      return `Marked paid${
        m.amount_cents != null
          ? ` (${centsUsd(m.amount_cents)})`
          : m.amount != null
            ? ` ($${Number(m.amount).toLocaleString("en-US")})`
            : ""
      }`;
    case "links_rotated":
      return "Customer/job links regenerated (old links disabled)";
    case "quote_created_manually":
      return `Lead logged by staff${m.by ? ` (${String(m.by)})` : ""}`;
    default:
      return e.type.replace(/_/g, " ");
  }
}
