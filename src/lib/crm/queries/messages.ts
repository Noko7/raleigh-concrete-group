// Server-only CRM data access: the message log and the quiet-hours queue. Re-exported from ../queries.ts.
import { pgUser, pgAdmin } from "../rest";
import { MAX_SEND_ATTEMPTS, RETRY_BACKOFF_MINUTES, planRetry } from "../send-retry";
import type { Session } from "../types";

export { MAX_SEND_ATTEMPTS };

// ── Message log ─────────────────────────────────────────────────────────────
// Every attempted text gets a row, sent or not. Sends are best-effort (an SMS
// outage must never fail a submission), and this is the trace next to the job.

// `kind` names the notification; `role` is who it was aimed at.
export type SmsLog = { quoteId?: string | null; kind: string; role: "customer" | "owner" | "crew" };

export type QuoteMessage = {
  id: string;
  quote_id: string | null;
  created_at: string;
  kind: string;
  role: string;
  to_phone: string | null;
  body: string | null;
  ok: boolean;
  provider: string | null;
  status: number | null;
  detail: string | null;
  // Quiet-hours hold: when it may go out, and when the queue sent it. Null on
  // texts sent immediately.
  send_after?: string | null;
  sent_at?: string | null;
  // Staff called it back before it sent; the row stays.
  cancelled_at?: string | null;
  // Provider hand-offs so far; a failed send is requeued until MAX_SEND_ATTEMPTS.
  attempts?: number | null;
};

// Waiting for its send time, or due and not yet flushed. Cancelled rows aren't
// held (they never will send).
export function isHeld(m: QuoteMessage): boolean {
  return Boolean(m.send_after) && !m.sent_at && !m.cancelled_at;
}

// Called back by staff before sending. Not a failure.
export function isCancelled(m: QuoteMessage): boolean {
  return Boolean(m.cancelled_at) && !m.sent_at;
}

/**
 * Still stoppable: held, and send_after is still in the future. Narrower than
 * isHeld: once due, the next flush may already have it, and Cancel would race.
 */
export function isCancellable(m: QuoteMessage, now: Date = new Date()): boolean {
  if (!isHeld(m)) return false;
  const due = new Date(m.send_after as string).getTime();
  return Number.isFinite(due) && due > now.getTime();
}

/**
 * Has this exact text gone to this number just now? Guards against a server
 * action running twice (double submit, retry), which the action itself can't
 * detect. Matched on number + body, since that's what the customer sees twice.
 * The window is short so a deliberate later resend still works. Held copies
 * count; cancelled ones don't.
 */
export async function recentlySent(toPhone: string, body: string, withinSeconds = 90): Promise<boolean> {
  try {
    const since = new Date(Date.now() - withinSeconds * 1000).toISOString();
    const res = await pgAdmin(
      `quote_messages?to_phone=eq.${encodeURIComponent(toPhone)}` +
        `&created_at=gte.${encodeURIComponent(since)}&cancelled_at=is.null` +
        `&select=body&order=created_at.desc&limit=20`,
    );
    if (!res.ok) return false;
    const rows = (await res.json()) as { body: string | null }[];
    return rows.some((r) => r.body === body);
  } catch {
    // Never block a send on the guard failing; a missed text is worse than a duplicate.
    return false;
  }
}

// Service-role: sends come from the public endpoint and cron, with no session.
// Never throws, so a logging failure can't take a send down with it.
export async function logMessage(row: {
  quote_id?: string | null;
  kind: string;
  role: string;
  to_phone?: string | null;
  body?: string | null;
  ok: boolean;
  provider?: string | null;
  status?: number | null;
  detail?: string | null;
  // Quiet-hours hold only: this row is also the queue entry, due then.
  send_after?: string | null;
  // Resolves to whether the row was written. Load-bearing for a held text:
  // false means nothing will ever send it.
}): Promise<boolean> {
  try {
    const res = await pgAdmin("quote_messages", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        quote_id: row.quote_id ?? null,
        kind: row.kind,
        role: row.role,
        to_phone: row.to_phone ?? null,
        // Capped: for reading back, not archiving.
        body: row.body ? row.body.slice(0, 4000) : null,
        ok: row.ok,
        provider: row.provider ?? null,
        status: row.status ?? null,
        detail: row.detail ? row.detail.slice(0, 2000) : null,
        ...(row.send_after ? { send_after: row.send_after } : {}),
      }),
    });
    if (!res.ok) {
      // A missing table would otherwise make every send look fine while nothing is recorded.
      console.error("[sms-log] could not record message", { status: res.status, kind: row.kind });
    }
    return res.ok;
  } catch (e) {
    console.error("[sms-log] threw", e);
    return false;
  }
}

// ── The quiet-hours queue ───────────────────────────────────────────────────
// Texts raised 7pm-8am wait here with a send_after. notify.ts's flush lists
// what's due, claims one, then records the outcome.

export async function listDueMessages(nowIso: string, limit = 25): Promise<QuoteMessage[]> {
  const res = await pgAdmin(
    `quote_messages?sent_at=is.null&cancelled_at=is.null&send_after=lte.${encodeURIComponent(nowIso)}` +
      `&select=*&order=send_after.asc&limit=${limit}`,
  );
  // Throws rather than returning []: an unreadable queue must not look empty,
  // or held texts silently stop going out.
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`Could not read the held-message queue (HTTP ${res.status}). ${detail}`.trim());
  }
  return (await res.json()) as QuoteMessage[];
}

/**
 * Claim a queued message; false if someone else got it. Crons and passing
 * requests can race for one row, so `sent_at=is.null` decides the winner.
 * Stamped before sending: a crash leaves a text unsent rather than sent twice.
 * `cancelled_at=is.null` lets a cancel landing between list and claim win.
 */
export async function claimMessage(id: string, nowIso: string): Promise<boolean> {
  try {
    const res = await pgAdmin(`quote_messages?id=eq.${encodeURIComponent(id)}&sent_at=is.null&cancelled_at=is.null`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ sent_at: nowIso }),
    });
    if (!res.ok) return false;
    return ((await res.json()) as unknown[]).length > 0;
  } catch {
    return false;
  }
}

export async function finishMessage(
  id: string,
  result: {
    ok: boolean;
    provider?: string | null;
    status?: number | null;
    detail?: string | null;
    unsent?: boolean;
  },
  attempts = 0,
): Promise<void> {
  const plan = planRetry(result, attempts);
  const detail = [result.detail, plan.note].filter(Boolean).join(" ") || null;
  const outcome = {
    ok: result.ok,
    provider: result.provider ?? null,
    status: result.status ?? null,
    detail: detail ? detail.slice(0, 2000) : null,
  };
  const patch = (body: Record<string, unknown>) =>
    pgAdmin(`quote_messages?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(body),
    });

  try {
    const res = await patch({
      ...outcome,
      attempts: plan.attempts,
      // Releasing the claim lets the next drain see it again.
      ...(plan.retrying
        ? { sent_at: null, send_after: new Date(Date.now() + RETRY_BACKOFF_MINUTES * 60_000).toISOString() }
        : {}),
    });
    if (!res.ok) {
      // Recording the outcome matters more than the retry bookkeeping, so try it on its own.
      console.error("[sms-queue] could not record the result of a held message", { status: res.status });
      await patch(outcome);
    }
  } catch (e) {
    console.error("[sms-queue] could not record the result of a held message", e);
  }
}

/**
 * Held-queue state for the Settings diagnostic. `overdue` > 0 means whatever
 * drains the queue isn't running.
 */
export type QueueHealth = { waiting: number; overdue: number; oldestDueIso: string | null; error?: string };

export async function queueHealth(at: Date = new Date()): Promise<QueueHealth> {
  const empty: QueueHealth = { waiting: 0, overdue: 0, oldestDueIso: null };
  try {
    const res = await pgAdmin(
      `quote_messages?sent_at=is.null&cancelled_at=is.null&send_after=not.is.null` +
        `&select=send_after&order=send_after.asc&limit=200`,
    );
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      return { ...empty, error: `HTTP ${res.status}. ${detail}`.trim() };
    }
    const rows = (await res.json()) as { send_after: string | null }[];
    // Parse, don't string-compare: Postgres returns "+00:00" while toISOString()
    // writes ".000Z", and those sort on punctuation, not time.
    const cutoff = at.getTime();
    const due = rows.filter((r) => {
      const t = r.send_after ? new Date(r.send_after).getTime() : NaN;
      return Number.isFinite(t) && t <= cutoff;
    });
    return {
      waiting: rows.length,
      overdue: due.length,
      oldestDueIso: due[0]?.send_after ?? null,
    };
  } catch (e) {
    return { ...empty, error: String(e) };
  }
}

/**
 * Call a queued text back; null if too late or never queued. Service role
 * because staff can only SELECT the log; the caller has checked job access.
 */
export async function cancelMessage(id: string, quoteId: string, nowIso: string): Promise<QuoteMessage | null> {
  try {
    const res = await pgAdmin(
      // send_after in the future is the eligibility rule, enforced by the DB:
      // once due, the flush may already hold the row and a cancel would race.
      `quote_messages?id=eq.${encodeURIComponent(id)}&quote_id=eq.${encodeURIComponent(quoteId)}` +
        `&sent_at=is.null&cancelled_at=is.null&send_after=gt.${encodeURIComponent(nowIso)}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ cancelled_at: nowIso, detail: "Cancelled by staff before it went out." }),
      },
    );
    if (!res.ok) return null;
    // Returned so the activity log can name which text was stopped.
    return ((await res.json()) as QuoteMessage[])[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Cancel every queued text for a job, or only those of one `kind` or `role`.
 * Retracting a quote must also stop a text held overnight about it; withdrawing
 * a change stops its own; a job moved to Lost stops the customer's. Returns how
 * many were stopped.
 */
export async function cancelQueuedFor(
  quoteId: string,
  nowIso: string,
  opts: { kind?: string; role?: "customer" | "owner" | "crew"; detail?: string } = {},
): Promise<number> {
  try {
    const res = await pgAdmin(
      `quote_messages?quote_id=eq.${encodeURIComponent(quoteId)}` +
        (opts.kind ? `&kind=eq.${encodeURIComponent(opts.kind)}` : "") +
        (opts.role ? `&role=eq.${opts.role}` : "") +
        `&sent_at=is.null&cancelled_at=is.null&send_after=not.is.null`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ cancelled_at: nowIso, detail: opts.detail ?? "Cancelled: the quote was retracted." }),
      },
    );
    if (!res.ok) return 0;
    return ((await res.json()) as unknown[]).length;
  } catch {
    return 0;
  }
}

/**
 * Has a customer text of this kind, raised since `sinceIso`, reached them or
 * started to? Delivered rows are ok; a claimed held row (sent_at set) may be
 * at the provider now. Cancelled rows never went. Errs to true on a failed
 * read: an extra "never mind" beats a customer left with a dead link.
 */
export async function customerTextWentOut(quoteId: string, kind: string, sinceIso: string): Promise<boolean> {
  try {
    const res = await pgAdmin(
      `quote_messages?quote_id=eq.${encodeURIComponent(quoteId)}&kind=eq.${encodeURIComponent(kind)}` +
        `&role=eq.customer&created_at=gte.${encodeURIComponent(sinceIso)}&cancelled_at=is.null` +
        `&or=(ok.is.true,sent_at.not.is.null)&select=id&limit=1`,
    );
    if (!res.ok) return true;
    return ((await res.json()) as unknown[]).length > 0;
  } catch {
    return true;
  }
}

// Service role; the caller has already checked it can open the job.
export async function getMessage(id: string, quoteId: string): Promise<QuoteMessage | null> {
  const res = await pgAdmin(
    `quote_messages?id=eq.${encodeURIComponent(id)}&quote_id=eq.${encodeURIComponent(quoteId)}&select=*&limit=1`,
  );
  if (!res.ok) return null;
  return ((await res.json()) as QuoteMessage[])[0] ?? null;
}

export async function listMessages(session: Session, quoteId: string): Promise<QuoteMessage[]> {
  const res = await pgUser(
    `quote_messages?quote_id=eq.${encodeURIComponent(quoteId)}&select=*&order=created_at.desc&limit=200`,
    session.accessToken,
  );
  if (!res.ok) return [];
  return (await res.json()) as QuoteMessage[];
}

// Latest attempt of one kind. Only the log can tell "texted" from "tried and bounced".
export async function lastMessageOf(session: Session, quoteId: string, kind: string): Promise<QuoteMessage | null> {
  const res = await pgUser(
    `quote_messages?quote_id=eq.${encodeURIComponent(quoteId)}&kind=eq.${encodeURIComponent(kind)}` +
      `&select=*&order=created_at.desc&limit=1`,
    session.accessToken,
  );
  if (!res.ok) return null;
  return ((await res.json()) as QuoteMessage[])[0] ?? null;
}
