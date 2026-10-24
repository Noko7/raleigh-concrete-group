"use client";

import { useActionState } from "react";

import { savePhoneLinesAction } from "./actions";
import type { SaveState } from "./types";

type QuoOption = { number: string; label: string };
type Contractor = { id: string; name: string };

const initial: SaveState = { ok: true };

// Owner-only. Each contractor's customers hear from that contractor's own Quo line, so the contractor sees
// every text in their Quo inbox and gets the replies. Anyone left on "Business number" works as before.
export function PhoneLinesForm({
  numbers,
  contractors,
  business,
  lines,
  envFrom,
  loadError,
}: {
  numbers: QuoOption[];
  contractors: Contractor[];
  business: string | null;
  lines: Record<string, string>;
  envFrom: string | null;
  loadError: string | null;
}) {
  const [state, formAction, pending] = useActionState(savePhoneLinesAction, initial);

  return (
    <form action={formAction} className="crm-card crm-settings">
      <h2 className="crm-card-title">Phone lines (Quo)</h2>
      <p className="crm-muted crm-sm">
        Give a contractor their own Quo number and every text to customers on their jobs goes out from it:
        quotes, change orders, scheduling, reminders and payment links. They see each text in their Quo app and
        customers&apos; replies come straight to them. New-lead receipts, unassigned jobs and alerts to you use
        the business number.
      </p>
      <p className="crm-muted crm-sm">
        Optional for each contractor. Anyone left on &quot;Business number&quot; keeps working exactly as now. Jobs
        already in progress switch to the contractor&apos;s line from their next text; nothing to move over.
      </p>

      {loadError ? (
        <p className="crm-auth-error">{loadError}</p>
      ) : (
        <>
          <label className="crm-field">
            <span>Business number</span>
            <select className="crm-input" name="business" defaultValue={business ?? ""}>
              <option value="">{envFrom ? `Default from Vercel (${envFrom})` : "Default from Vercel (QUO_FROM)"}</option>
              {numbers.map((n) => (
                <option key={n.number} value={n.number}>
                  {n.label}
                </option>
              ))}
            </select>
          </label>

          {contractors.map((c) => (
            <label key={c.id} className="crm-field">
              <span>{c.name}</span>
              <select className="crm-input" name={`line_${c.id}`} defaultValue={lines[c.id] ?? ""}>
                <option value="">Business number (no line of their own)</option>
                {numbers.map((n) => (
                  <option key={n.number} value={n.number}>
                    {n.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
          {contractors.length === 0 && <p className="crm-muted crm-sm">No active contractors yet.</p>}

          {state.error && <p className="crm-auth-error">{state.error}</p>}
          {state.saved && !state.error && <p className="crm-saved">Saved. The next text on each job uses its line.</p>}

          <button type="submit" className="crm-btn crm-btn-primary" disabled={pending}>
            {pending ? "Saving…" : "Save phone lines"}
          </button>
        </>
      )}
    </form>
  );
}
