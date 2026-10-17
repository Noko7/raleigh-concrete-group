// What the queue does with one send attempt's result. Pure (finishMessage applies it, tests check it).
// Keyed on what we know happened, not whether a status came back: "never made the request" must not be
// treated like "may have gone through", or a missing QUO_API_KEY destroys the queue.

/**
 * A capped number: a landline or unmessageable number fails identically every time. Three rides out a
 * provider blip.
 */
export const MAX_SEND_ATTEMPTS = 3;

// Long enough to not hammer, short enough for the next drain.
export const RETRY_BACKOFF_MINUTES = 10;

export type SendOutcome = {
  ok: boolean;
  status?: number | null;
  /** We returned before making the request, so it definitely did not send. */
  unsent?: boolean;
};

export type RetryPlan = {
  /** Release the claim so the next drain retries. */
  retrying: boolean;
  /** An unsent row spends nothing. */
  attempts: number;
  /** Appended to the provider's words in the log. */
  note: string | null;
};

/**
 *   unsent     no request made (missing API key, unset from-number). Costs no attempt and is ALWAYS put
 *              back: a misconfigured deploy must not eat the queue.
 *   a status   the provider refused it; retry until the cap.
 *   no status  the call threw (timeout, dropped connection). It may have arrived, so it stays claimed:
 *              a missed text beats a duplicate.
 * Pass MAX_SEND_ATTEMPTS as `attempts` to make a row terminal (a held row with no number or body).
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
