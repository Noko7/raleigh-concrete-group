"use client";

import { useActionState } from "react";

import { retryFailedText } from "./send-actions";
import type { ScheduleState } from "./types";

// Retry on a text that failed (owner only). Asks first, since it texts a customer or the crew again; the server
// re-checks every rule (retryRefusal) before anything is sent.
export function RetryFailedText({
  quoteId,
  messageId,
  to,
  what,
  preview,
}: {
  quoteId: string;
  messageId: string;
  to: string;
  // The kind of text and its opening words, so a stale one is not resent blind.
  what: string;
  preview: string;
}) {
  const [state, action, pending] = useActionState<ScheduleState, FormData>(retryFailedText, { ok: false });
  if (state.ok) return <p className="msg-now-ok">{state.message ?? "Sent again."}</p>;

  const submit = (fd: FormData) => {
    if (!window.confirm(`Send this ${what} text to ${to} again?\n\n"${preview}"`)) return;
    fd.set("id", quoteId);
    fd.set("messageId", messageId);
    action(fd);
  };

  return (
    <form action={submit} className="msg-now">
      <button type="submit" className="crm-btn crm-btn-ghost msg-now-btn" disabled={pending}>
        {pending ? "Sending…" : "Retry"}
      </button>
      {state.error && <span className="msg-now-err">{state.error}</span>}
    </form>
  );
}
