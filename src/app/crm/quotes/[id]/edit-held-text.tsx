"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { editHeldText } from "./actions";
import type { ScheduleState } from "./types";

// A queued text, shown as it will arrive, with a way to reword it before it
// goes. Shown on the CRM job page and the crew's job page alike.
//
// Offered only while the text is still safely in the queue (isCancellable):
// once its hour has come the flush may be holding it, and an edit that lands a
// second late would change a text that is already on the customer's phone.
// The server enforces the same rule, so a stale page can only be told "too
// late", never half-succeed.
export function EditHeldText({
  quoteId,
  messageId,
  body,
  canEdit,
  className = "jh-body",
}: {
  quoteId: string;
  messageId: string;
  body: string;
  canEdit: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(body);
  const [state, action, pending] = useActionState<ScheduleState, FormData>(editHeldText, { ok: false });

  // A save lands: close the box and pull the saved wording back from the server.
  useEffect(() => {
    if (state.ok) {
      setEditing(false);
      router.refresh();
    }
  }, [state, router]);
  // The page refreshed with new wording (this edit, or someone else's).
  useEffect(() => {
    if (!editing) setDraft(body);
  }, [body, editing]);

  if (!editing) {
    return (
      <>
        <p className={className}>{body}</p>
        {state.ok && state.message && <p className="het-ok">{state.message}</p>}
        {canEdit && (
          <button type="button" className="het-open" onClick={() => setEditing(true)}>
            Edit text
          </button>
        )}
      </>
    );
  }

  const submit = (fd: FormData) => {
    fd.set("id", quoteId);
    fd.set("messageId", messageId);
    fd.set("body", draft);
    action(fd);
  };

  return (
    <form action={submit} className="het-form">
      <textarea
        className="het-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={Math.min(14, Math.max(5, draft.split("\n").length + 1))}
        maxLength={1000}
        aria-label="Text message wording"
        disabled={pending}
      />
      <div className="het-acts">
        <button type="submit" className="het-save" disabled={pending || !draft.trim()}>
          {pending ? "Saving…" : "Save wording"}
        </button>
        <button
          type="button"
          className="het-cancel"
          disabled={pending}
          onClick={() => {
            setDraft(body);
            setEditing(false);
          }}
        >
          Keep as is
        </button>
        <span className="het-count">{draft.length} / 1000</span>
      </div>
      {state.error && !pending && <p className="het-err">{state.error}</p>}
    </form>
  );
}
