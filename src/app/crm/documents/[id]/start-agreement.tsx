"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { archiveAndRestartAction, startAgreementAction } from "./agreement-actions";

export type TemplateChoice = { id: string; name: string };

function TemplatePicker({ choices, value, onChange }: { choices: TemplateChoice[]; value: string; onChange: (v: string) => void }) {
  if (choices.length === 0) return null;
  return (
    <label className="ae-field ae-pickt">
      <span>Start from the template</span>
      <select className="crm-input" value={value} onChange={(e) => onChange(e.target.value)}>
        {choices.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}

// No agreement written in the CRM yet: pick a template (repair jobs default to Repair) and draft version 1 from the job.
export function StartAgreement({ quoteId, choices, defaultId }: { quoteId: string; choices: TemplateChoice[]; defaultId: string | null }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState(defaultId ?? choices[0]?.id ?? "");
  const router = useRouter();
  return (
    <div className="ae-start">
      <p className="crm-muted crm-sm">
        Drafts the agreement from this job: the customer, the contractor, the approved work and the price, with the
        template&apos;s terms. You can edit every section before it goes out, and every save is kept as a version.
      </p>
      <TemplatePicker choices={choices} value={templateId} onChange={setTemplateId} />
      <button
        type="button"
        className="crm-btn crm-btn-primary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await startAgreementAction(quoteId, templateId || null);
            if (r.ok) router.refresh();
            else setError(r.error ?? "Couldn't start the agreement.");
          })
        }
      >
        {pending ? "Drafting…" : "Write the agreement"}
      </button>
      {error && <p className="jr-err" role="alert">{error}</p>}
    </div>
  );
}

// Set the current agreement aside (it stays under "Earlier agreements" with its history) and start over from a template.
export function RestartAgreement({ quoteId, agreementId, choices, defaultId }: { quoteId: string; agreementId: string; choices: TemplateChoice[]; defaultId: string | null }) {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState(defaultId ?? choices[0]?.id ?? "");
  const router = useRouter();
  if (!open) {
    return (
      <button type="button" className="ae-link" onClick={() => setOpen(true)}>
        Start over from a template…
      </button>
    );
  }
  return (
    <div className="ae-start ae-restart">
      <p className="crm-sm">
        This agreement is set aside, with all its versions, under Earlier agreements, and a new one is drafted from the job.
      </p>
      <TemplatePicker choices={choices} value={templateId} onChange={setTemplateId} />
      <div className="ae-save-acts">
        <button type="button" className="crm-btn crm-btn-ghost" onClick={() => setOpen(false)} disabled={pending}>
          Keep this one
        </button>
        <button
          type="button"
          className="crm-btn crm-btn-primary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await archiveAndRestartAction(quoteId, agreementId, templateId || null);
              if (r.ok) {
                setOpen(false);
                router.refresh();
              } else setError(r.error ?? "Couldn't start over.");
            })
          }
        >
          {pending ? "Starting over…" : "Set aside and start over"}
        </button>
      </div>
      {error && <p className="jr-err" role="alert">{error}</p>}
    </div>
  );
}
