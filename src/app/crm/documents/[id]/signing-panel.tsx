"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DocusealForm } from "@docuseal/react";

import { cancelSigningAction } from "./agreement-actions";

// Where an agreement is in signing, on the job's documents page. The contractor signs here, embedded; the customer
// signs on their own page (/sign/<token>) once the contractor has. The owner sees the customer's link to resend.
export type SigningView = {
  status: string;
  versionNo: number | null;
  sentAt: string | null;
  contractorSignedAt: string | null;
  signedAt: string | null;
  expiresAt: string | null;
  declineReason: string | null;
  contractorEmbed: string | null;
  customerLink: string | null;
  hasPdf: boolean;
  hasAudit: boolean;
  agreementId: string;
};

function day(iso: string | null) {
  return iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) : "";
}

export function SigningPanel({ quoteId, view, isContractor, isOwner }: { quoteId: string; view: SigningView; isContractor: boolean; isOwner: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const out = view.status === "sent" || view.status === "contractor_signed";

  const steps = [
    { done: Boolean(view.sentAt), label: `Sent version ${view.versionNo ?? ""}`, at: view.sentAt },
    { done: Boolean(view.contractorSignedAt), label: "Contractor signed", at: view.contractorSignedAt },
    { done: view.status === "signed", label: "Customer signed", at: view.signedAt },
  ];

  return (
    <section className="crm-card sp" aria-label="Signing">
      <h2 className="crm-card-title">Signing</h2>
      <ol className="sp-steps">
        {steps.map((s) => (
          <li key={s.label} className={s.done ? "sp-done" : undefined}>
            <span aria-hidden="true">{s.done ? "✓" : "○"}</span> {s.label}
            {s.at && <em> · {day(s.at)}</em>}
          </li>
        ))}
      </ol>

      {view.status === "declined" && (
        <p className="ae-note">Declined{view.declineReason ? `: ${view.declineReason.replace(/[.\s]+$/, "")}.` : "."} Edit the agreement and send it again.</p>
      )}
      {view.status === "expired" && <p className="ae-note">Nobody signed in time, so it expired. Edit or just send it again.</p>}
      {out && view.expiresAt && <p className="crm-muted crm-sm">The links stop working {day(view.expiresAt)}.</p>}

      {view.status === "sent" && isContractor && view.contractorEmbed && (
        <div className="sp-form">
          <p>
            <strong>Your signature comes first.</strong> Read it through, then sign. The customer gets their link as soon as you&apos;re done.
          </p>
          <DocusealForm src={view.contractorEmbed} withTitle={false} withDownloadButton={false} onComplete={() => setTimeout(() => router.refresh(), 2500)} />
        </div>
      )}
      {view.status === "sent" && !isContractor && <p className="crm-sm">Waiting on the contractor to sign. They were texted a link to this page.</p>}
      {view.status === "contractor_signed" && (
        <div className="crm-sm">
          <p>Waiting on the customer. They were texted their link.</p>
          {view.customerLink && (
            <div className="sp-link">
              <code>{view.customerLink}</code>
              <button
                type="button"
                className="crm-btn crm-btn-ghost"
                onClick={() => navigator.clipboard?.writeText(view.customerLink!).then(() => setCopied(true), () => setCopied(false))}
              >
                {copied ? "Copied" : "Copy link"}
              </button>
            </div>
          )}
        </div>
      )}
      {view.status === "signed" && (
        <div className="sp-files">
          {view.hasPdf ? (
            <a className="crm-btn crm-btn-primary" href={`/crm/api/agreement?id=${encodeURIComponent(view.agreementId)}`} target="_blank" rel="noreferrer">
              Signed PDF
            </a>
          ) : (
            <p className="jr-err">Signed, but the PDF hasn&apos;t been stored yet. It is in DocuSeal; it will be copied here on the next try.</p>
          )}
          {view.hasAudit && (
            <a className="crm-btn crm-btn-ghost" href={`/crm/api/agreement?id=${encodeURIComponent(view.agreementId)}&part=audit`} target="_blank" rel="noreferrer">
              Audit log
            </a>
          )}
        </div>
      )}

      {out && (isOwner || isContractor) && (
        <button
          type="button"
          className="ae-link"
          disabled={pending}
          onClick={() => {
            if (!window.confirm("Cancel signing? The links stop working and the agreement can be edited again.")) return;
            start(async () => {
              const r = await cancelSigningAction(quoteId, view.agreementId);
              if (r.ok) router.refresh();
              else setMsg(r.error ?? "Couldn't cancel.");
            });
          }}
        >
          Cancel signing
        </button>
      )}
      {msg && <p className="jr-err" role="alert">{msg}</p>}
    </section>
  );
}
