// Server-only CRM data access: change orders. Re-exported from ../queries.ts.
import {
  CHANGE_NOTE_MAX,
  noEmDash,
  optionsTotal,
  boughtLines,
  changeStartLines,
  sameChangeLines,
  type QuoteOptionDraft,
} from "../constants";
// fees.ts imports nothing local, so this can't form a cycle.
import { toCents } from "../fees";
import { changeOrderRefusal, jobPatchRefusal } from "../permissions";
import { pgAdmin } from "../rest";
import type { Quote, Session } from "../types";
import { getQuote, updateQuoteResult } from "./quotes";
import { listQuoteOptions, listQuotePackages } from "./line-items";
import { getQuoteByToken } from "./responses";

// ── Change orders ───────────────────────────────────────────────────────────
// A price change on an agreed (usually booked) job is a small quote of its own:
// the price only moves when the customer says yes. Sent, withdrawn, answered.
//
// Money needs nothing special: the ledger is "current total minus collected"
// (readLedger in fees.ts) and the office cut is re-derived from the frozen rate,
// so a $4,125 deposit on an $8,250 job that becomes $9,400 leaves $5,275 owed.

// One object so every path that ends a change clears every change column; a
// half-cleared change leaves the customer page waiting forever.
const CLEAR_CHANGE: Partial<Quote> = {
  change_note: null,
  change_amount: null,
  change_requested_at: null,
  change_requested_by: null,
  change_lines: null,
  change_deposit_cents: null,
};

export type ChangeRequestResult = { ok: boolean; error?: string; quote?: Quote };

/**
 * Send a change for the customer to approve. Runs as the user, so RLS keeps a
 * contractor to their own jobs (the crew take these calls).
 */
export async function requestChange(
  session: Session,
  id: string,
  input: { note: string; newAmount: number; lines?: QuoteOptionDraft[]; depositCents?: number | null; paidCents?: number },
): Promise<ChangeRequestResult> {
  const current = await getQuote(session, id);
  if (!current) return { ok: false, error: "You don't have access to this job." };

  // Only on an accepted job. Before that the quote itself is editable, and a
  // "change" would put two offers in front of the customer.
  if (current.customer_response !== "accepted" || current.status === "lost") {
    return { ok: false, error: "This job isn't approved yet. Change the quote itself instead." };
  }
  // Closed-out work is an invoice dispute for the office, not a change order.
  if (current.status === "completed" || current.status === "paid") {
    return { ok: false, error: "This job is already closed out. Give the office a call to sort out the price." };
  }
  if (current.change_requested_at) {
    return { ok: false, error: "There's already a change waiting on the customer. Withdraw it first." };
  }

  const note = noEmDash(input.note.trim()).slice(0, CHANGE_NOTE_MAX);
  if (note.length < 3) return { ok: false, error: "Say what's changing, so the customer knows what they're approving." };

  // When lines are given they ARE the price: the total is their sum, so the
  // customer never sees lines that add up to something else.
  const lines = (input.lines ?? []).map((l) => ({
    title: l.title,
    description: l.description || null,
    amount: l.amount,
  }));
  const [existing, packages] = await Promise.all([listQuoteOptions(session, id), listQuotePackages(session, id)]);
  // A package job's price sits outside the line items, so a breakdown couldn't
  // add up. Rare; change it as one figure.
  if (lines.length > 0 && packages.length > 0) {
    return { ok: false, error: "This job was priced as a choice of options, so change the total as one figure." };
  }
  // Change lines replace the job's lines on approval. A job that already has
  // lines always gets a list (even empty), or old lines would sit under a new
  // total. Package jobs keep their extras untouched; only the figure moves.
  const changeLines = packages.length > 0 ? null : lines.length > 0 || existing.length > 0 ? lines : null;

  const amount =
    lines.length > 0 ? optionsTotal(lines) : Math.round(Number(input.newAmount) * 100) / 100;
  if (!Number.isFinite(amount) || amount < 0 || amount > 99_999_999) {
    return { ok: false, error: "Enter a valid new total for the job." };
  }
  // Same total is fine when the breakdown changes. Compared with where the
  // crew's breakdown started (changeStartLines), so a one-price job's own
  // "as approved" line isn't a change.
  const linesChanged =
    changeLines !== null &&
    !sameChangeLines(changeLines, changeStartLines(boughtLines(existing), current.quote_amount, current.service));
  if (toCents(amount) === toCents(current.quote_amount) && !linesChanged) {
    return { ok: false, error: "That's the same total they already agreed to. Change the figure, or just call them." };
  }

  // Optional second deposit: whole cents, at least $1, and no more than the
  // balance after the change.
  let deposit: number | null = null;
  if (input.depositCents != null) {
    deposit = Math.round(Number(input.depositCents));
    const balance = toCents(amount) - Math.max(0, input.paidCents ?? 0);
    if (!Number.isFinite(deposit) || deposit < 100) {
      return { ok: false, error: "Enter how much they need to send up front, or untick the deposit." };
    }
    if (deposit > balance) {
      return { ok: false, error: "The deposit can't be more than what they'll owe after this change." };
    }
  }

  const changePatch: Partial<Quote> = {
    change_note: note,
    change_amount: amount,
    change_requested_at: new Date().toISOString(),
    change_requested_by: session.staff.id,
    change_lines: changeLines,
    change_deposit_cents: deposit,
  };
  // Against the computed total, lines and all: a contractor's change may only raise it.
  const refusal = jobPatchRefusal(session.staff.role, current, changePatch, session.staff.id);
  if (refusal) return { ok: false, error: refusal };

  const { quote, error } = await updateQuoteResult(session, id, changePatch);
  if (!quote) {
    return {
      ok: false,
      error: error ?? "Could not send that change. Please try again or call the office.",
    };
  }
  return { ok: true, quote };
}

/**
 * Withdraw a change before the customer answers. The price never moved, so
 * clearing the change columns is all there is to undo.
 */
export async function cancelChange(session: Session, id: string): Promise<ChangeRequestResult> {
  const current = await getQuote(session, id);
  if (!current) return { ok: false, error: "You don't have access to this job." };
  if (!current.change_requested_at) return { ok: false, error: "There's no change waiting on this job." };

  const { quote, error } = await updateQuoteResult(session, id, CLEAR_CHANGE);
  if (!quote) return { ok: false, error: error ?? "Could not withdraw that change." };
  return { ok: true, quote };
}

export type ChangeResponseResult = {
  ok: boolean;
  error?: string;
  /** Nothing was written because their answer was already on file. */
  duplicate?: boolean;
  quote?: Quote;
  /** What the job was worth before, and what it is worth now. */
  from?: number | null;
  to?: number | null;
  note?: string | null;
  /** The second deposit the approved change asked for, in cents, if any. */
  depositCents?: number | null;
  /** The change on the job is not the one the customer's page showed. Nothing was written. */
  stale?: boolean;
};

const STALE_CHANGE_ERROR ="This change was updated, please reload the page.";

/**
 * The customer's answer from their quote link. Service role: no session, the
 * token authorises it. Accepting only sets quote_amount; balance, office cut,
 * payment page and existing deposits all re-derive from it.
 */
export async function recordChangeResponse(
  token: string,
  action: "accept" | "decline",
  /** The change_requested_at the customer's page displayed; null if it showed none. */
  shownRequestedAt: string | null = null,
): Promise<ChangeResponseResult> {
  if (!/^[a-f0-9]{16,40}$/i.test(token)) return { ok: false, error: "Invalid link." };

  const q = await getQuoteByToken("public_token", token);
  if (!q) return { ok: false, error: "Quote not found." };

  // Nothing waiting: usually a second tap or a change withdrawn while the tab
  // was open. Success, because there's nothing left for them to do.
  if (!q.change_requested_at || q.change_amount == null) return { ok: true, duplicate: true };

  return applyChange(q.id, action === "accept", {}, shownRequestedAt);
}

/**
 * Apply a change the customer agreed to by phone or on site. Same transaction
 * and log row as their own tap, plus `recorded_by`. requestChange has already
 * checked access and figures.
 */
export async function recordChangeAgreed(
  session: Session,
  id: string,
): Promise<ChangeResponseResult> {
  // Owner only, rechecked because applyChange runs with the service role.
  const refusal = changeOrderRefusal(session.staff.role, { agreed: true });
  if (refusal) return { ok: false, error: refusal };
  const by = session.staff.full_name || session.staff.email || "Staff";
  return applyChange(id, true, { recorded_by: by });
}

async function applyChange(
  quoteId: string,
  accept: boolean,
  extraMeta: Record<string, unknown> = {},
  shownRequestedAt: string | null = null,
): Promise<ChangeResponseResult> {
  const action = accept ? "accept" : "decline";

  // Price, breakdown and cleared change in one transaction, so a failed second
  // write can't leave new lines against an old total. The page's
  // change_requested_at is checked under the row lock. Paid state is
  // resyncJobPaidState's call, made by the caller afterwards (both directions).
  const call = (args: Record<string, unknown>) =>
    pgAdmin("rpc/apply_change_response", { method: "POST", body: JSON.stringify(args) });
  const args = { p_id: quoteId, p_accept: accept };
  const res = shownRequestedAt ? await call({ ...args, p_requested_at: shownRequestedAt }) : await call(args);
  if (!res.ok) return { ok: false, error: "Could not save your answer. Please call us." };
  const out = (await res.json()) as {
    status: "ok" | "none" | "stale";
    quote?: Quote;
    from?: number | null;
    to?: number | null;
    note?: string | null;
    old_lines?: unknown;
    new_lines?: unknown;
    deposit_cents?: number | null;
  };
  if (out.status === "stale") return { ok: false, stale: true, error: STALE_CHANGE_ERROR };
  // Answered in another tab between the read and the lock.
  if (out.status !== "ok" || !out.quote) return { ok: true, duplicate: true };

  const from = out.from ?? null;
  const to = out.to == null ? null : Number(out.to);
  const note = out.note ?? null;

  await pgAdmin("quote_events", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      quote_id: quoteId,
      type: action === "accept" ? "change_accepted" : "change_declined",
      // Breakdown before and after, so the log shows what the job used to include.
      meta: {
        from,
        to,
        note,
        ...(out.new_lines != null ? { lines_before: out.old_lines, lines_after: out.new_lines } : {}),
        ...(out.deposit_cents != null ? { deposit_cents: out.deposit_cents } : {}),
        ...extraMeta,
      },
    }),
  }).catch(() => {});

  return { ok: true, quote: out.quote, from, to, note, depositCents: out.deposit_cents ?? null };
}
