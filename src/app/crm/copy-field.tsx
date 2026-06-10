"use client";

import { useState } from "react";

export function CopyField({ label, value }: { label: string; value: string }) {
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
        <button type="button" className="crm-btn crm-btn-ghost" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
