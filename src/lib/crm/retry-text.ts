// When an owner may press Retry on a text that failed. Pure, so it's unit-tested. The rules exist so a retry can
// never become a pile of texts to one person:
//   - only a real failure (not sent, not held for later, not cancelled), with a number and words to send;
//   - nothing older than 2 days: a reminder or visit time goes stale fast;
//   - not if a newer text of the same kind to the same number already went out or is waiting to;
//   - at most 3 tries of the same text to the same number in 24 hours.

export type RetryableText = {
  id: string;
  created_at: string;
  kind: string;
  to_phone: string | null;
  body: string | null;
  ok: boolean;
  send_after?: string | null;
  sent_at?: string | null;
  cancelled_at?: string | null;
};

export const RETRY_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000;
export const RETRY_MAX_TRIES_PER_DAY = 3;

const held = (m: RetryableText) => !m.ok && Boolean(m.send_after) && !m.sent_at && !m.cancelled_at;
const failed = (m: RetryableText) => !m.ok && !held(m) && !m.cancelled_at;

/** Why this text can't be retried, or null when it can. `all` is every text on the same job. */
export function retryRefusal(m: RetryableText, all: readonly RetryableText[], nowMs: number): string | null {
  if (!failed(m)) return "Only a text that failed can be retried.";
  if (!m.to_phone || !m.body) return "There's no number or message on this text to send.";
  const at = Date.parse(m.created_at);
  if (nowMs - at > RETRY_MAX_AGE_MS) return "This text is more than 2 days old, so it may be out of date. Send a fresh one instead.";

  const sameText = all.filter((o) => o.id !== m.id && o.kind === m.kind && o.to_phone === m.to_phone);
  if (sameText.some((o) => Date.parse(o.created_at) > at && (o.ok || held(o)))) {
    return "A newer text like this one already went to this number (or is waiting to), so it won't be sent twice.";
  }
  if (sameText.some((o) => Date.parse(o.created_at) > at && failed(o))) {
    return "A newer try of this text failed too. Retry that one instead.";
  }
  const tries = [m, ...sameText].filter((o) => (o.body ?? "") === m.body && nowMs - Date.parse(o.created_at) < 86_400_000);
  if (tries.length >= RETRY_MAX_TRIES_PER_DAY) return "This text has been tried 3 times today. Check the number, or call them.";
  return null;
}
