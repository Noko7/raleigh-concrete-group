"use client";

import { useState } from "react";

// openHref: where Open goes, when it shouldn't be the copied link itself (the customer's page opens as a
// preview, so the office opening it isn't counted as the customer viewing it).
export function CopyField({ label, value, openHref }: { label: string; value: string; openHref?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  return (
    <div className="crm-copy">
      <span className="crm-copy-label">{label}</span>
      <div className="crm-copy-row">
        <input className="crm-input crm-copy-input" readOnly value={value} onFocus={(e) => e.currentTarget.select()} />
        {openHref && (
          <a href={openHref} target="_blank" rel="noreferrer" className="crm-btn crm-btn-primary">
            Open
          </a>
        )}
        <button type="button" className="crm-btn crm-btn-ghost" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
