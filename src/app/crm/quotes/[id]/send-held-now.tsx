"use client";

import { useActionState, useState } from "react";

import { dict, type Locale } from "@/lib/crm/i18n";
import { sendHeldTextNow } from "./send-actions";
import type { ScheduleState } from "./types";

// "Don't wait - send it now." Quiet hours hold customer texts until 8am, which is wrong for a corrected
// price; this is one deliberate, logged override. Two taps: the first only asks, so a thumb meant for
// Cancel just below can't send a text that can't be taken back.
// Offered on ANY held row, past its hour too, unlike Cancel: losing the race here only finds the row
// already claimed (one text either way), whereas a late cancel would mislabel a delivered text.
export function SendHeldNow({
  quoteId,
  messageId,
  // Inside quiet hours the tap has a named consequence: it's 6:40am for the customer.
  quiet,
  locale = "en",
}: {
  quoteId: string;
  messageId: string;
  quiet: boolean;
  locale?: Locale;
}) {
  const t = dict(locale).heldText;
  const [state, action, pending] = useActionState<ScheduleState, FormData>(sendHeldTextNow, { ok: false });
  const [confirming, setConfirming] = useState(false);

  // Written here, where the reader's language is known; the action serves both CRM and crew pages.
  if (state.ok) return <p className="msg-now-ok">{t.sent}</p>;

  const submit = (fd: FormData) => {
    fd.set("id", quoteId);
    fd.set("messageId", messageId);
    setConfirming(false);
    action(fd);
  };

  if (!confirming) {
    return (
      <div className="msg-now">
        <button type="button" className="crm-btn crm-btn-ghost msg-now-btn" onClick={() => setConfirming(true)} disabled={pending}>
          {pending ? t.sending : t.send}
        </button>
        <span className="crm-muted crm-sm">{t.hint}</span>
        {state.error && <span className="msg-now-err">{state.error}</span>}
      </div>
    );
  }

  return (
    <form action={submit} className="msg-now">
      <strong className="msg-now-ask">{t.confirm}</strong>
      <button type="submit" className="crm-btn crm-btn-primary msg-now-btn" disabled={pending}>
        {t.confirmYes}
      </button>
      <button type="button" className="crm-btn crm-btn-ghost msg-now-btn" onClick={() => setConfirming(false)} disabled={pending}>
        {t.confirmNo}
      </button>
      {quiet && <span className="crm-muted crm-sm msg-now-quiet">{t.quietWarning}</span>}
    </form>
  );
}
