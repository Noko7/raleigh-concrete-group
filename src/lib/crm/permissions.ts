// Who may change what on a job, once money and the customer's say-so are
// involved.
//
// The office earns a percentage of the job total, so the total is the office's
// income, and a contractor lowering the price of a job the customer already
// agreed to cuts that income without anybody noticing. The owner's rule:
//
//   * Before the customer answers, the crew edit the quote exactly as before.
//   * Once they have answered, the price moves only through a change order the
//     customer approves on their own link. Applying a change "already agreed"
//     on the phone, with no text to the customer, is the owner's alone.
//   * Paid is the ledger's word (or the owner's), never the crew's.
//   * The owner can override all of it.
//
// The database enforces the same rule on the row itself
// (supabase/stage1-price-lockdown.sql), because a contractor can talk to it
// without the app. This file is the app's copy: it lets the server refuse with
// a sentence a person can act on, instead of a 403, and it covers the one write
// a contractor makes that the database cannot see as theirs - marking a job
// Lost, which the server does with the service role (updateQuoteResult).
// Change one, change the other.
//
// Pure on purpose - no network, no database, no server-only imports - so the
// rules are unit tested (permissions.test.ts) and safe to import anywhere.
// (The .ts extensions are for that runner; both modules import nothing.)
import { firstNameOf } from "./constants.ts";
import { toCents } from "./fees.ts";

/** The parts of a job the rules read. A full Quote satisfies it. */
export type JobForPermissions = {
  status: string;
  customer_response: "accepted" | "declined" | null;
  change_requested_at?: string | null;
} & Partial<Record<string, unknown>>;

/** A write about to be made to that job: only the keys it sets. */
export type JobPatch = Partial<Record<string, unknown>>;

type Money = number | string | null | undefined;

/**
 * Has the customer answered this quote, as every customer-facing screen reads
 * it? Accepted, or declined and still Lost. A declined quote the office has
 * moved off Lost is open again (isOpenAgain in queries.ts): their link shows it
 * and the next save clears the old "no", so the crew may re-price it.
 */
export function customerHasAnswered(job: Pick<JobForPermissions, "status" | "customer_response">): boolean {
  if (job.customer_response === "accepted") return true;
  return job.customer_response === "declined" && job.status === "lost";
}

// ── The columns, grouped the way the database guard groups them ────────────

/** Written by the server (service role) or the owner, never by the crew. */
export const OFFICE_ONLY_COLUMNS = [
  // The office's cut.
  "fee_rate",
  "fee_total_cents",
  "fee_waived_cents",
  "fee_waived_note",
  // Whether the job counts at all.
  "is_test",
  "archived_at",
  // Money the ledger records: paid in full, and the deposit an approved change
  // asked for.
  "paid_at",
  "deposit_target_cents",
] as const;

/** Who every text and receipt about the job goes to. */
export const CONTACT_COLUMNS = ["phone", "email"] as const;

/** The agreed price. Frozen for the crew once the customer has answered. */
export const PRICE_COLUMNS = ["quote_amount", "discount_accepted"] as const;

/** The customer's answer. Clearing it would unlock the price above. */
export const ANSWER_COLUMNS = ["customer_response", "customer_responded_at"] as const;

/** A change order waiting on the customer. Opened or withdrawn, never rewritten. */
export const CHANGE_COLUMNS = [
  "change_note",
  "change_amount",
  "change_requested_at",
  "change_requested_by",
  "change_lines",
  "change_deposit_cents",
] as const;

/** Columns whose values are money, compared to the cent rather than as text. */
const MONEY_COLUMNS = new Set<string>(["quote_amount", "change_amount"]);

/**
 * Whether a patch value differs from what the row holds. A key the patch does
 * not carry is not a change. Money is compared in cents, because PostgREST
 * hands numeric back as either a number or a string ("8250.00") depending on
 * the column, and 8250 is not a change from "8250.00".
 */
function changes(job: JobForPermissions, patch: JobPatch, column: string): boolean {
  if (!(column in patch) || patch[column] === undefined) return false;
  const next = patch[column] ?? null;
  const now = job[column] ?? null;
  if (next === null || now === null) return next !== now;
  if (MONEY_COLUMNS.has(column)) {
    const a = Math.round(Number(next) * 100);
    const b = Math.round(Number(now) * 100);
    if (Number.isFinite(a) && Number.isFinite(b)) return a !== b;
  }
  if (typeof next === "object" || typeof now === "object") return JSON.stringify(next) !== JSON.stringify(now);
  return next !== now;
}

function customerFirstName(name: unknown): string {
  return firstNameOf(typeof name === "string" ? name : "", "The customer");
}

export const LOWER_CHANGE_REFUSAL = "Lowering an approved price is done by the office.";

/**
 * Why this person may not make this write to this job, or null if they may.
 *
 * `role` is the staff role. Only "owner" is exempt; anything else is held to
 * the contractor's rules, so an unexpected role fails closed. The message is
 * shown as-is on the crew's screen, in the same voice as the rest of them.
 * `actorId` is who is writing; when given, a change order opened in anybody
 * else's name is refused, as the database refuses it.
 */
export function jobPatchRefusal(
  role: string,
  job: JobForPermissions,
  patch: JobPatch,
  actorId?: string | null,
): string | null {
  if (role === "owner") return null;
  const first = customerFirstName(job.name);

  // Paid, and moving off it. Every other status the crew set today stays
  // theirs: booking, releasing a day, marking it done, a phone approval,
  // sending a quote, Lost.
  if (changes(job, patch, "status") && (patch.status === "paid" || job.status === "paid")) {
    return patch.status === "paid"
      ? "Only the office can mark a job paid. It moves to Paid by itself once the payments recorded on it add up to the total."
      : "This job is marked paid, so only the office can move it. Give them a call if it needs changing.";
  }

  for (const column of OFFICE_ONLY_COLUMNS) {
    if (!changes(job, patch, column)) continue;
    if (column === "paid_at") {
      return "Only the office can mark a job paid. It moves to Paid by itself once the payments recorded on it add up to the total.";
    }
    if (column === "deposit_target_cents") {
      return "The deposit on a change is set when the customer approves that change. Send them a change order to ask for one.";
    }
    return "Only the office can change that on a job.";
  }

  if (CONTACT_COLUMNS.some((c) => changes(job, patch, c))) {
    return "Only the office can change the customer's phone or email.";
  }

  if (customerHasAnswered(job)) {
    for (const column of PRICE_COLUMNS) {
      if (changes(job, patch, column)) {
        return `${first} already approved this price, so it can't be edited. To change it, send ${first === "The customer" ? "them" : first} a change order to approve.`;
      }
    }
    for (const column of ANSWER_COLUMNS) {
      if (changes(job, patch, column)) {
        return `${first}'s answer is on file, so only the office can change it.`;
      }
    }
  }

  // A change already in front of the customer: withdrawing it (every column
  // cleared) is fine, rewriting it in place is not - they may be reading it.
  if (job.change_requested_at) {
    const touched = CHANGE_COLUMNS.some((c) => changes(job, patch, c));
    const clearsAll = CHANGE_COLUMNS.every((c) => c in patch && patch[c] === null);
    if (touched && !clearsAll) {
      return "There's already a change waiting on the customer. Withdraw it first.";
    }
  } else if (patch.change_requested_at != null) {
    // Opening one. The crew can reach the customer's link, so whatever they
    // open they can also approve: theirs may only raise the total.
    if (actorId !== undefined && (patch.change_requested_by ?? null) !== actorId) {
      return "A change order can only be sent in your own name.";
    }
    if (toCents(patch.change_amount as Money) < toCents(job.quote_amount as Money)) {
      return LOWER_CHANGE_REFUSAL;
    }
  }

  return null;
}

/**
 * Why this person may not send this change order, or null if they may.
 *
 * `agreed` is the "already agreed - don't text them" option: the new total goes
 * straight onto the job with nobody asked. That is the price moving without the
 * customer's say-so on record, so it is the owner's alone. Anybody may send a
 * change for the customer to approve, but only the owner one that lowers the
 * total (`toTotal` below `fromTotal`).
 */
export function changeOrderRefusal(
  role: string,
  input: {
    agreed: boolean;
    customerName?: string | null;
    /** The total the customer agreed to, and the one the change asks for. */
    fromTotal?: Money;
    toTotal?: Money;
  },
): string | null {
  if (role === "owner") return null;
  if (input.toTotal !== undefined && toCents(input.toTotal) < toCents(input.fromTotal)) return LOWER_CHANGE_REFUSAL;
  if (!input.agreed) return null;
  const first = customerFirstName(input.customerName);
  const who = first === "The customer" ? "the customer" : first;
  return `Only the owner can apply a change without texting the customer. Send it to ${who} to approve instead - nothing moves until they do.`;
}

/**
 * The values jobPatchRefusal decided on, as column -> value, for a write that
 * cannot rely on the database guard (the service role skips it). Filtering the
 * write on these means a row that moved in between - the customer answering,
 * say - matches nothing instead of being written over. change_lines is left
 * out because jsonb is not matched by equality in a filter; change_requested_at
 * already pins a pending change.
 */
export function refusalBasis(job: JobForPermissions, patch: JobPatch): Record<string, unknown> {
  const columns = new Set<string>(["status", "customer_response", "change_requested_at"]);
  for (const c of [...OFFICE_ONLY_COLUMNS, ...CONTACT_COLUMNS, ...PRICE_COLUMNS, ...ANSWER_COLUMNS, ...CHANGE_COLUMNS]) {
    if (c in patch && c !== "change_lines") columns.add(c);
  }
  return Object.fromEntries([...columns].map((c) => [c, job[c] ?? null]));
}
