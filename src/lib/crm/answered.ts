// What a quote's answer on file means for another one arriving. Pure (recordCustomerResponse and
// recordOfflineAcceptance apply it, answered.test.ts checks it), so the up-front check and the
// conditional write that backs it always give the same verdict.

export type Answer = "accepted" | "declined";

type AnswerState = { customer_response: Answer | null; status: string };

/**
 * The customer's own path. The same answer again is the success it already was, with nothing written;
 * a different one is refused, because flipping an accepted quote from a stale tab strands a booked day.
 */
export function repeatAnswer(
  already: Answer,
  action: "accept" | "decline",
): { ok: true; duplicate: true } | { ok: false; error: string } {
  const want: Answer = action === "accept" ? "accepted" : "declined";
  if (already === want) return { ok: true, duplicate: true };
  return {
    ok: false,
    error:
      already === "accepted"
        ? "You've already approved this quote. Give us a call if you need to change anything."
        : "You've already declined this quote. Give us a call if you've changed your mind.",
  };
}

/**
 * The PostgREST filter that makes the customer's write land only on the state that was checked: no
 * answer yet, or a decline the office has reopened (isOpenAgain). Two submissions racing past the
 * check then can't both write, and only the first recomputes the price.
 */
export function unansweredFilter(openAgain: boolean): string {
  return openAgain ? "&customer_response=eq.declined&status=neq.lost" : "&customer_response=is.null";
}

/**
 * Staff recording a verbal yes. Not "duplicate: fine" like the customer's double tap: a person typed
 * this in, and an answer on file that disagrees with their call needs looking at, not overwriting.
 * Null means the approval may be written.
 */
export function offlineAcceptanceRefusal(q: AnswerState): string | null {
  if (q.customer_response === "accepted") return "This quote is already marked approved.";
  if (q.customer_response === "declined" || q.status === "lost") {
    return "This quote is marked declined. Ask the office to reopen it before recording an approval.";
  }
  // Writing "approved" onto a finished job would drag its status back and lose the completion.
  if (q.status === "completed" || q.status === "paid") {
    return "This job is already closed out. Nothing left to approve.";
  }
  return null;
}
