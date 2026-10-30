// Plain-English activity log, shared by the job page and Security dashboard.
import { BUSINESS_TZ, clockLabel } from "./clock";
import { dollars, STATUS_LABELS } from "./constants";
import { usd } from "./fees";
import { fill, type Dict } from "./i18n";
import { messageLabel } from "./messages";
import type { QuoteEvent } from "./types";

const statusLabel = (v: unknown) => STATUS_LABELS[String(v) as keyof typeof STATUS_LABELS] ?? String(v ?? "N/A");

// Log money is in CENTS. Named for its unit because quote_revised below has a local helper in DOLLARS.
const centsUsd = (v: unknown) => (v == null ? "$0.00" : usd(Number(v) || 0));

// A day in Raleigh, e.g. "Nov 29, 2026".
const expiryDay = (v: unknown) => {
  const d = new Date(String(v));
  return Number.isNaN(d.getTime())
    ? "a later date"
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: BUSINESS_TZ });
};

// Raleigh time, e.g. "tomorrow at 8:00 AM".
const heldWhen = (v: unknown) => {
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? "in the morning" : clockLabel(d);
};

/**
 * Versions of the quote sent to the customer, oldest first, read from the activity log (one row per send;
 * a correction records what it replaced) rather than a separate versions table.
 * Older sends carry no amount: it's read from the revision that replaced them, and the last send is the
 * current price.
 * `added` marks a send from "send them another option", so it isn't labelled a correction.
 */
export type QuoteSend = {
  id: string;
  at: string;
  amount: number | null;
  corrected: boolean;
  added: string | null;
};

export function quoteSends(events: QuoteEvent[], currentAmount: number | null): QuoteSend[] {
  const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
  const rows = events
    .filter((e) => e.type === "quote_sent" || e.type === "quote_revised")
    .slice()
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((e) => {
      const m = (e.meta ?? {}) as Record<string, unknown>;
      return {
        id: e.id,
        at: e.created_at,
        corrected: e.type === "quote_revised",
        added: typeof m.added === "string" && m.added ? m.added : null,
        amount: e.type === "quote_revised" ? num(m.to) : num(m.amount),
        replaced: e.type === "quote_revised" ? num(m.from) : null,
      };
    });

  // Backwards, so each gap is filled by the send that came after it.
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].amount != null) continue;
    rows[i].amount = i + 1 < rows.length ? rows[i + 1].replaced : currentAmount;
  }
  return rows.map(({ id, at, amount, corrected, added }) => ({ id, at, amount, corrected, added }));
}

/**
 * The log cut down to what a contractor needs, in their language; null for everything else.
 * A whitelist so new office-only event types stay off the crew's page (which customers may see).
 */
export function crewEventText(e: QuoteEvent, t: Dict): string | null {
  const l = t.contractorJob.log;
  const m = (e.meta ?? {}) as Record<string, unknown>;
  switch (e.type) {
    case "assigned":
      // Only the assignment; "unassigned" is an office decision.
      return m.to ? l.assigned : null;
    case "quote_sent":
      return l.quoteSent;
    case "quote_revised":
      return m.added ? fill(l.quoteOptionAdded, { title: String(m.added) }) : l.quoteRevised;
    case "customer_viewed":
      return l.customerViewed;
    // Customer tapped their link vs. office logged a call; see `channel` meta from acceptOffline.
    case "customer_accepted":
      return m.channel === "phone" ? l.customerAcceptedPhone : l.customerAccepted;
    case "customer_declined":
      return l.customerDeclined;
    case "visit_confirmed":
      return l.visitConfirmed;
    case "visit_moved":
      return l.visitMoved;
    case "visit_cancelled":
      return l.visitCancelled;
    // Change orders change what the crew are paid to do, so every state is shown, including "still waiting".
    case "change_requested":
      return l.changeSent;
    case "change_accepted":
      return l.changeAccepted;
    case "change_declined":
      return l.changeDeclined;
    case "change_withdrawn":
      return l.changeWithdrawn;
    case "date_confirmed":
      return l.dateConfirmed;
    case "date_changed":
      return l.dateChanged;
    case "booking_cancelled":
      return l.bookingCancelled;
    case "customer_confirmed":
      return l.customerConfirmed;
    case "job_completed":
      return l.jobCompleted;
    case "payment_received":
      return l.paymentReceived;
    // Changes what is left to collect and what they owe the office.
    case "payment_corrected":
      return l.paymentCorrected;
    case "payment_voided":
      return l.paymentVoided;
    default:
      return null;
  }
}

export function eventActor(e: QuoteEvent, names: Map<string, string>): string {
  if (e.actor) return names.get(e.actor) ?? "A teammate";
  if (e.type.startsWith("customer_")) return "Customer";
  return "Automatic";
}

export function eventText(e: QuoteEvent, names: Map<string, string>): string {
  const m = (e.meta ?? {}) as Record<string, unknown>;
  switch (e.type) {
    case "status_changed":
      // Moved by the database's 5-minute sweep, not a person.
      if (m.reason === "expired") return `Quote expired with no answer. Status: ${statusLabel(m.from)} → ${statusLabel(m.to)}`;
      return `Status: ${statusLabel(m.from)} → ${statusLabel(m.to)}`;
    case "receipt_issued":
      return `Receipt #${String(m.number ?? "").padStart(6, "0")} issued for ${centsUsd(m.amount_cents)}${m.replaces ? " (replaces a voided one)" : ""}`;
    case "receipt_voided":
      return `Receipt #${String(m.number ?? "").padStart(6, "0")} voided${m.reason ? `: ${String(m.reason)}` : ""}`;
    // Quotes went from 10 to 30 days; the unanswered ones were moved to match (migration 20261030221241).
    case "expiry_extended":
      return `Quote now good through ${expiryDay(m.to)} (quotes are good for ${String(m.ttl_days ?? 30)} days)`;
    case "assigned":
      return m.to ? `Assigned to ${names.get(String(m.to)) ?? "a contractor"}` : "Unassigned";
    case "amount_changed":
      return `Price set to ${dollars(m.to as number) ?? "(cleared)"}`;
    case "summary_changed":
      return "Customer description updated";
    case "notes_changed":
      return "Internal notes updated";
    case "quote_reopened":
      return "Declined quote reopened";
    case "quote_sent":
      return "Quote sent to the customer";
    // Both figures: whether and how much the price moved is the point.
    case "quote_revised": {
      const money = (v: unknown) => dollars(v as number) ?? "no price";
      // An added option is not a correction: nothing shown was wrong.
      if (m.added) return `Another option sent to the customer: ${String(m.added)} (now ${money(m.to)})`;
      return m.from !== m.to
        ? `Corrected quote sent to the customer (was ${money(m.from)}, now ${money(m.to)})`
        : "Corrected quote sent to the customer (wording changed)";
    }
    case "quote_delivery":
      // Held for quiet hours is not a failure; it resolves itself at 8am.
      if (m.delivered) return `Quote link texted to ${String(m.to ?? "the customer")}`;
      if (m.held_until) return `Quote link queued for ${String(m.to ?? "the customer")} (quiet hours, goes out ${heldWhen(m.held_until)})`;
      return `Quote text FAILED to ${String(m.to ?? "the customer")}${m.error ? ` - ${String(m.error)}` : ""}`;
    case "customer_viewed":
      return "Customer opened their quote";
    // Count and all-in figure tell a repriced quote from a reshuffled one.
    case "options_changed": {
      const n = Number(m.count ?? 0);
      const total = m.total != null ? ` (${dollars(m.total as number)} all in)` : "";
      return n === 0 ? "Line items removed - back to a single price" : `Line items updated: ${n} item(s)${total}`;
    }
    // Two or more is a quote asking a question; zero has stopped asking.
    case "packages_changed": {
      const n = Number(m.count ?? 0);
      return n === 0
        ? "Choice of options removed - back to a single quote"
        : `Customer will be asked to pick between ${n} options`;
    }
    case "customer_accepted": {
      const picks = Array.isArray(m.preferred_dates) ? (m.preferred_dates as string[]) : [];
      // Older entries recorded days only.
      const at = Array.isArray(m.preferred_times) ? (m.preferred_times as (string | null)[]) : [];
      const asked = picks.map((d, i) => `${d}${at[i] ? ` ${at[i]}` : ""}`);
      const wanted = asked.length ? `, prefers ${asked.join(", ")}` : "";
      // The total alone doesn't say which options are in.
      const yes = Array.isArray(m.accepted_options) ? (m.accepted_options as string[]) : [];
      const no = Array.isArray(m.declined_options) ? (m.declined_options as string[]) : [];
      const pick = m.chosen_package ? String(m.chosen_package) : "";
      const took = [pick, ...yes].filter(Boolean);
      const chose = took.length ? `: took ${took.join(", ")}${no.length ? `, left ${no.join(", ")}` : ""}` : "";
      // A phone approval must never read the same as one the customer gave.
      if (m.channel === "phone") {
        const by = m.recorded_by ? String(m.recorded_by) : "staff";
        const agreed = picks.length ? `, agreed ${asked.join(", ")}` : "";
        return `Approval recorded over the phone by ${by}${chose}${agreed}`;
      }
      return `Customer approved the quote${chose}${wanted}${m.discount ? " ($150 credit)" : ""}`;
    }
    // Change orders are the only thing that moves an agreed price, so every row shows from what, to what.
    case "change_requested": {
      const money = (v: unknown) => dollars(v as number) ?? "no price";
      const paid = m.paid_cents != null ? `, ${centsUsd(m.paid_cents)} already paid` : "";
      // Who checked the ledger half of the balance the customer is approving.
      const by = m.payments_checked_by ? `, payments checked by ${String(m.payments_checked_by)}` : "";
      const what = m.agreed ? "Change agreed with the customer directly, not texted" : "Change sent for approval";
      return `${what}: ${money(m.from)} → ${money(m.to)}${paid}${by}${m.note ? ` - "${String(m.note)}"` : ""}`;
    }
    case "fee_waived": {
      const to = Number(m.to_cents ?? 0);
      const note = m.note ? ` - "${String(m.note)}"` : "";
      return to > 0 ? `Office fee: ${centsUsd(to)} waived by the owner${note}` : "Office fee waiver cleared";
    }
    case "change_delivery":
      if (m.delivered) return `Change request texted to ${String(m.to ?? "the customer")}`;
      if (m.held_until) return `Change request queued for ${String(m.to ?? "the customer")} (quiet hours, goes out ${heldWhen(m.held_until)})`;
      return `Change request text FAILED to ${String(m.to ?? "the customer")}${m.error ? ` - ${String(m.error)}` : ""}`;
    case "change_accepted": {
      const money = (v: unknown) => dollars(v as number) ?? "no price";
      if (m.recorded_by) return `Change applied, agreed directly and recorded by ${String(m.recorded_by)}: ${money(m.from)} → ${money(m.to)}`;
      return `Customer approved the change: ${money(m.from)} → ${money(m.to)}`;
    }
    case "change_declined": {
      const money = (v: unknown) => dollars(v as number) ?? "no price";
      return `Customer turned down the change, price stays ${money(m.from)}`;
    }
    case "change_withdrawn": {
      const money = (v: unknown) => dollars(v as number) ?? "no price";
      return `Change withdrawn before the customer answered${m.to != null ? ` (would have been ${money(m.to)})` : ""}`;
    }
    case "date_confirmed":
      return `Work day confirmed for ${String(m.to ?? "a date")}${m.to_time ? ` at ${String(m.to_time)}` : ""}`;
    case "date_changed":
      return `Work day moved${m.from ? ` from ${String(m.from)}${m.from_time ? ` ${String(m.from_time)}` : ""}` : ""} to ${String(m.to ?? "a new date")}${m.to_time ? ` at ${String(m.to_time)}` : ""}${m.notified === false ? ", customer not texted" : ""}`;
    case "visit_confirmed": {
      const when = `${String(m.to ?? "a date")}${m.to_time ? ` at ${String(m.to_time)}` : ""}`;
      // "We agreed" vs. "we told them a new time".
      const asked =
        m.moved && m.requested
          ? ` (customer had asked for ${String(m.requested)}${m.requested_time ? ` at ${String(m.requested_time)}` : ""})`
          : "";
      return `Quote visit confirmed for ${when}${asked}`;
    }
    case "visit_moved":
      return `Quote visit moved${m.from ? ` from ${String(m.from)}${m.from_time ? ` ${String(m.from_time)}` : ""}` : ""} to ${String(m.to ?? "a new date")}${m.to_time ? ` at ${String(m.to_time)}` : ""}${m.notified === false ? ", customer not texted" : ""}`;
    case "visit_cancelled":
      return `Quote visit cancelled${m.from ? ` (was ${String(m.from)}${m.from_time ? ` ${String(m.from_time)}` : ""})` : ""}${m.notified ? ", customer texted" : ""}`;
    case "booking_cancelled":
      return `Work day released${m.from ? ` (was ${String(m.from)}${m.from_time ? ` ${String(m.from_time)}` : ""})` : ""}${m.notified ? ", customer texted" : ""}`;
    case "customer_declined":
      return "Customer declined the quote";
    case "reminder_sent":
      return "Confirmation reminder texted to the customer";
    case "stale_lead_reminded": {
      // One text covers every stale lead (logged without a job id), so this says which batch.
      const of = Number(m.of);
      return of > 1
        ? `Chased as untouched, in a list of ${of} sent to the crew`
        : "Chased as untouched: nudge texted to the crew";
    }
    case "crew_reminded": {
      const d = Number(m.days_out);
      const when = d === 0 ? "morning of" : d === 1 ? "day before" : `${d} days out`;
      // Queued behind that person's other texts is not a failure.
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
    // Not a commitment; tells the crew whether to expect a card or a cheque.
    case "payment_choice":
      return m.choice === "card"
        ? "Customer chose to pay by card"
        : "Customer chose to pay the crew directly";
    case "payment_received": {
      const how = String(m.method ?? "payment");
      const fee = Number(m.fee_cents ?? 0);
      // The only record of whether the fee was collected with the payment or left owed.
      return `${how === "card" ? "Card payment" : `${how.charAt(0).toUpperCase()}${how.slice(1)} recorded`}: ${centsUsd(m.amount_cents)}${
        how === "card" ? ` (fee ${centsUsd(fee)})` : ""
      }`;
    }
    case "payment_refunded":
      return `Refunded ${centsUsd(m.amount_cents)}`;
    // Both figures, always: this row is the only record the first figure existed.
    case "payment_corrected": {
      const moved =
        m.from_method && m.to_method && m.from_method !== m.to_method
          ? `, ${String(m.from_method)} → ${String(m.to_method)}`
          : "";
      return `Recorded payment corrected: ${centsUsd(m.from_cents)} → ${centsUsd(m.to_cents)}${moved}`;
    }
    case "payment_voided":
      return `Recorded payment voided: ${centsUsd(m.amount_cents)}${
        m.method ? ` (${String(m.method)})` : ""
      }${m.reason ? ` - "${String(m.reason)}"` : ""}`;
    case "job_paid":
      return `Marked paid${
        m.amount_cents != null
          ? ` (${centsUsd(m.amount_cents)})`
          : m.amount != null
            ? ` (${dollars(m.amount as number)})`
            : ""
      }`;
    // An early send was a deliberate choice (e.g. a 6:40am text), so it gets its own line.
    case "message_sent_early":
      return `Queued text sent early${m.kind ? ` (${messageLabel(String(m.kind))})` : ""}${
        m.delivered === false ? ", and it failed" : ""
      }`;
    case "message_cancelled":
      return `Queued text cancelled before it sent${m.kind ? ` (${messageLabel(String(m.kind))})` : ""}`;
    case "quote_retracted":
      return `Quote retracted and wiped${m.amount != null ? ` (was ${dollars(m.amount as number)})` : ""}${
        m.texts_cancelled ? `, ${Number(m.texts_cancelled)} queued text(s) stopped` : ""
      }`;
    case "marked_test":
      return "Marked as a test lead (left out of the Money page)";
    case "unmarked_test":
      return "No longer a test lead (counted on the Money page again)";
    case "links_rotated":
      return "Customer/job links regenerated (old links disabled)";
    case "quote_created_manually":
      return `Lead logged by staff${m.by ? ` (${String(m.by)})` : ""}`;
    default:
      return e.type.replace(/_/g, " ");
  }
}
