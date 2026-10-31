"use client";

import { useActionState, useState } from "react";

import { cancelHeldMessage } from "./send-actions";
import type { ScheduleState } from "./types";

// Stopping a reminder changes nothing else. The text that carries the quote IS the quote: stopping it
// clears the price, wording and customer link, so it says so in full first.

export function CancelHeldText({
  quoteId,
  messageId,
  isQuote,
  isOwner,
}: {
  quoteId: string;
  messageId: string;
  isQuote: boolean;
  isOwner: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState<ScheduleState, FormData>(cancelHeldMessage, { ok: false });

  // A contractor is told why there's no button.
  if (isQuote && !isOwner) {
    return <p className="msg-cancel-note">Only the owner can cancel a quote before it sends.</p>;
  }

  if (state.ok) {
    return <p className="msg-cancel-ok">{state.message}</p>;
  }

  const submit = (fd: FormData) => {
    fd.set("id", quoteId);
    fd.set("messageId", messageId);
    setConfirming(false);
    action(fd);
  };

  // Plain case: nothing is lost.
  if (!isQuote) {
    return (
      <form action={submit} className="msg-cancel">
        <button type="submit" className="crm-btn crm-btn-ghost msg-cancel-btn" disabled={pending}>
          {pending ? "Stopping…" : "Cancel this text"}
        </button>
        <span className="crm-muted crm-sm">It hasn&apos;t gone out yet. This stops it for good.</span>
        {state.error && <span className="msg-cancel-err">{state.error}</span>}
      </form>
    );
  }

  return (
    <div className="msg-cancel-quote">
      {state.error && <p className="msg-cancel-err">{state.error}</p>}

      {!confirming ? (
        <button type="button" className="msg-cancel-open" onClick={() => setConfirming(true)}>
          Cancel this quote before it sends
        </button>
      ) : (
        <form action={submit}>
          {/* Spelled out: every line is something the owner can't get back. */}
          <p className="msg-cancel-warn">
            The text never sends, the price and the quote sections are cleared, any line items are removed, the
            customer&apos;s link stops working, and the job goes back to New. None of it can be undone.
          </p>
          <div className="msg-cancel-acts">
            <button type="submit" className="crm-btn qs-btn-danger" disabled={pending}>
              {pending ? "Cancelling…" : "Yes, cancel the quote"}
            </button>
            <button
              type="button"
              className="crm-btn crm-btn-ghost"
              onClick={() => setConfirming(false)}
              disabled={pending}
            >
              Keep it
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
