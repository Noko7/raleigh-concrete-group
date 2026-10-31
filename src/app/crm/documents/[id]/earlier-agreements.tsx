"use client";

import { useState, useTransition } from "react";

import type { VersionSummary } from "@/lib/crm/agreement-versions";
import { getVersionAction } from "./agreement-actions";

// Agreements set aside on this job ("Start over from a template"), each with its full version history, read-only.
export type EarlierAgreement = { id: string; title: string; status: string; created_at: string; versions: VersionSummary[] };

const PREVIEW_CSS =
  "signature-field,initials-field,date-field{display:inline-block;border:1.5px dashed #c2682a;border-radius:4px;background:#fdf3ec;vertical-align:middle}" +
  "signature-field::before,initials-field::before,date-field::before{content:attr(name);font:9px Helvetica,Arial,sans-serif;color:#9a4f1c;padding:2px 4px;display:block}" +
  "body{max-width:7.5in;margin:24px auto;padding:0 16px}";

function when(iso: string) {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
}

export function EarlierAgreements({ items }: { items: EarlierAgreement[] }) {
  const [pending, start] = useTransition();
  const [modal, setModal] = useState<{ title: string; html: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (items.length === 0) return null;
  return (
    <section className="crm-card" aria-label="Earlier agreements">
      <details>
        <summary className="crm-card-title ea-summary">Earlier agreements ({items.length})</summary>
        <p className="crm-muted crm-sm">Set aside to start over. Kept for the record, exactly as saved.</p>
        <ul className="ea-list">
          {items.map((a) => (
            <li key={a.id}>
              <strong>{a.title}</strong>
              <span className="crm-muted crm-sm">
                {" "}
                · started {when(a.created_at)} · {a.status === "void" ? "set aside" : a.status}
              </span>
              <ul className="ea-versions">
                {a.versions.map((v) => (
                  <li key={v.id}>
                    <button
                      type="button"
                      className="ae-link"
                      disabled={pending}
                      onClick={() =>
                        start(async () => {
                          const r = await getVersionAction(v.id);
                          if (!r.ok) return setError(r.error);
                          setModal({ title: `${a.title}, version ${r.version_no}`, html: r.html.replace("</head>", `<style>${PREVIEW_CSS}</style></head>`) });
                        })
                      }
                    >
                      v{v.version_no}
                    </button>{" "}
                    <span className="crm-muted crm-sm">
                      {when(v.created_at)}
                      {v.created_by_name ? ` · ${v.created_by_name}` : ""}
                      {v.note ? ` · ${v.note}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        {error && <p className="jr-err" role="alert">{error}</p>}
      </details>
      {modal && (
        <div className="cv" role="dialog" aria-modal="true" aria-label={modal.title} onClick={() => setModal(null)}>
          <div className="cv-panel" onClick={(e) => e.stopPropagation()}>
            <div className="cv-head">
              <div className="cv-title">
                <h2>{modal.title}</h2>
              </div>
              <button type="button" className="qsm-x" aria-label="Close" onClick={() => setModal(null)}>
                &times;
              </button>
            </div>
            <div className="cv-stage">
              <iframe title={modal.title} className="cv-frame" sandbox="" srcDoc={modal.html} />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
