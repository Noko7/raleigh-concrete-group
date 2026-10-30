"use client";

import { useEffect, useState } from "react";

import { firstNameOf } from "@/lib/crm/constants";

// The customer's real quote page, framed in a modal: not a lookalike, so what's here is what's on their
// phone. ?preview=1 keeps it from counting as them opening it and makes its buttons inert, so nobody
// approves or pays on their behalf by tapping around.
//
// It shows the saved quote. While the editor has unsaved changes it says so, and can save and reload.
export function CustomerView({
  url,
  customerName,
  label,
  className = "crm-btn crm-btn-ghost",
  stale = false,
  onSave,
  saving = false,
  version = 0,
}: {
  url: string;
  customerName: string;
  label: string;
  className?: string;
  // The editor holds changes the page doesn't have yet.
  stale?: boolean;
  onSave?: () => void;
  saving?: boolean;
  // Bumped after a save, to reload the page.
  version?: number;
}) {
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState<"phone" | "computer">("phone");
  const first = firstNameOf(customerName, customerName);

  // Escape closes, and the page behind stops scrolling.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {label}
      </button>

      {open && (
        <div className="cv" role="dialog" aria-modal="true" aria-label={`What ${first} sees`} onClick={() => setOpen(false)}>
          <div className="cv-panel" onClick={(e) => e.stopPropagation()}>
            <div className="cv-head">
              <div className="cv-title">
                <h2>What {first} sees</h2>
                <p>Their real quote page. Nothing on it works from here, so you can&apos;t approve or pay by mistake.</p>
              </div>
              <button type="button" className="qsm-x" aria-label="Close" onClick={() => setOpen(false)}>
                &times;
              </button>
            </div>

            <div className="cv-bar">
              <div className="cv-seg" role="group" aria-label="Screen size">
                <button type="button" aria-pressed={width === "phone"} onClick={() => setWidth("phone")}>
                  Phone
                </button>
                <button type="button" aria-pressed={width === "computer"} onClick={() => setWidth("computer")}>
                  Computer
                </button>
              </div>
              <a href={url} target="_blank" rel="noreferrer" className="cv-newtab">
                Open in a new tab
              </a>
            </div>

            {stale && (
              <div className="cv-stale">
                <span>You have changes that aren&apos;t saved, so this is the quote as last saved.</span>
                {onSave && (
                  <button type="button" className="crm-btn crm-btn-primary" onClick={onSave} disabled={saving}>
                    {saving ? "Saving…" : "Save and show them"}
                  </button>
                )}
              </div>
            )}

            <div className="cv-stage">
              <iframe
                key={version}
                src={url}
                title={`${first}'s quote page`}
                className={width === "phone" ? "cv-frame cv-frame-phone" : "cv-frame"}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
