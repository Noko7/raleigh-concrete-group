// What the queue does with the result of one send attempt.
//
// Pure, and in its own file, because this is the decision that decides whether
// a customer's text survives a bad afternoon - and it is easy to get subtly
// wrong. The first version keyed the whole thing on whether an HTTP status came
// back, which quietly put "we never made the request" in the same bucket as
// "the request may have gone through". A missing QUO_API_KEY then destroyed
// every queued message the next drain touched, which is the exact failure the
// retry was written to prevent.
//
// No imports, no I/O: finishMessage applies the plan, the tests check it.

/**
 * How many times the queue hands one row to the provider before giving up.
 *
 * A cap rather than forever: a number that is a landline, or a workspace that
 * cannot message it, fails identically every time, and retrying that until the
 * heat death of the universe is only noise in the log. Three rides out a
 * provider blip and stops quickly on something that will never send.
 */
export const MAX_SEND_ATTEMPTS = 3;

// Far enough out that a retry is a fresh attempt rather than a hammering, near
// enough that the next drain picks it up rather than tomorrow's.
export const RETRY_BACKOFF_MINUTES = 10;

export type SendOutcome = {
  ok: boolean;
  status?: number | null;
  /** We returned before making the request, so it definitely did not send. */
  unsent?: boolean;
};

export type RetryPlan = {
  /** Release the claim and let the next drain try again. */
  retrying: boolean;
  /** What to store in `attempts`. An unsent row spends nothing. */
  attempts: number;
  /** Appended to the provider's own words in the log. Null when there is nothing to add. */
  note: string | null;
};

/**
 * Decide from what we actually know, not from what came back.
 *
 *   unsent     no request was made - a missing API key, an unset from-number.
 *              Nothing was tried, so it costs no attempt and is ALWAYS put
 *              back: a misconfigured deploy must not eat the queue. These rows
 *              wait, visibly, until the setting is fixed, and then they send.
 *
 *   a status   the round trip finished and the provider refused it. It did not
 *              send, so retry until the cap.
 *
 *   no status  the call threw - a timeout, a dropped connection. We cannot tell
 *              whether it arrived, so it stays claimed. A text nobody got beats
 *              one sent twice when the ambiguity is real.
 *
 * `attempts` is what the row carries now. Pass MAX_SEND_ATTEMPTS to declare a
 * row terminal - used for a held row with no number or body, which has nothing
 * to attempt and should not be annotated as though something was tried.
 */
export function planRetry(result: SendOutcome, attempts = 0): RetryPlan {
  const tried = attempts + 1;
  const refused = typeof result.status === "number";
  const neverSent = result.unsent === true && !result.ok;
  const terminal = attempts >= MAX_SEND_ATTEMPTS;
  const retrying = !result.ok && !terminal && (neverSent || (refused && tried < MAX_SEND_ATTEMPTS));

  const note =
    result.ok || terminal
      ? null
      : neverSent
        ? "(Nothing was sent - the text is still queued and will go out once this is fixed.)"
        : retrying
          ? `(Attempt ${tried} of ${MAX_SEND_ATTEMPTS}. Back on the queue for the next drain.)`
          : refused
            ? `(Attempt ${tried} of ${MAX_SEND_ATTEMPTS}. Not trying again.)`
            : "(The send did not complete, so we cannot tell whether it arrived. Not trying again, in case it did.)";

  return {
    retrying,
    attempts: neverSent ? attempts : Math.min(tried, MAX_SEND_ATTEMPTS),
    note,
  };
}
