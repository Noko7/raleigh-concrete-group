"use client";

import { useActionState } from "react";

import { dict, type Locale } from "@/lib/crm/i18n";
import { sendHeldTextNow } from "./actions";
import type { ScheduleState } from "./types";

// "Don't wait - send it now."
//
// Quiet hours hold a customer's text until 8am, which is right for a reminder
// and wrong for a corrected price. The contractor who has just fixed a number
// is racing the customer's decision, not their bedtime, and ninety minutes of
// a wrong figure sitting in somebody's thread is how a job gets approved at
// the old price.
//
// So the rule keeps its default and this is the way over it: one text, one
// deliberate tap, recorded on the job.
//
// Offered on ANY held row, including one whose hour has already passed - unlike
// Cancel, which hides itself once the drain might be mid-send. The difference
// is what losing the race costs. A cancel that arrives late marks a text
// cancelled that is already on a phone, and the log then lies. This one can
// only lose by finding the row already claimed, which it reports honestly and
// which leaves the customer with exactly one text either way.
export function SendHeldNow({
  quoteId,
  messageId,
  // Inside quiet hours the tap has a consequence worth naming: it is 6:40am
  // where the customer is. Outside them this is just "hurry it along".
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

  // The dictionary's words, not the server's. The action answers both the CRM
  // and a contractor's page, and it has no idea which language the person
  // reading it works in - so confirmation is written here, where that is known.
  if (state.ok) return <p className="msg-now-ok">{t.sent}</p>;

  const submit = (fd: FormData) => {
    fd.set("id", quoteId);
    fd.set("messageId", messageId);
    action(fd);
  };

  return (
    <form action={submit} className="msg-now">
      <button type="submit" className="crm-btn crm-btn-ghost msg-now-btn" disabled={pending}>
        {pending ? t.sending : t.send}
      </button>
      <span className="crm-muted crm-sm">{quiet ? t.quietWarning : t.hint}</span>
      {state.error && <span className="msg-now-err">{state.error}</span>}
    </form>
  );
}
