"use client";

import { useEffect, useRef } from "react";

import { longDate, money, WORK_NOTE, type AgreementBody } from "@/lib/crm/agreement-doc";

// The agreement laid out as the page it will be, with every section's text editable in place: click a paragraph
// and type, like the proposal builder. Plain text only (a line starting "- " is a bullet, **bold** is bold, the
// same as the form); names, numbers and money are set in the form, so they can't drift from the job here.
// Edits are committed when the text loses focus, so the cursor never jumps while typing; Escape puts it back.

function EditableText({ value, onCommit, onTyping, label, disabled }: { value: string; onCommit: (v: string) => void; onTyping: () => void; label: string; disabled: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Written into the DOM by hand (not as React children), and only when it isn't being typed in.
  useEffect(() => {
    const el = ref.current;
    if (el && document.activeElement !== el && el.innerText !== value) el.innerText = value;
  }, [value]);
  return (
    <div
      ref={ref}
      role="textbox"
      aria-multiline="true"
      aria-label={label}
      aria-readonly={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      contentEditable={disabled ? false : "plaintext-only"}
      suppressContentEditableWarning
      className={disabled ? "pe-text" : "pe-text pe-editable"}
      // Typing that hasn't been committed yet still counts as unsaved (Save lights up, leaving warns).
      onInput={onTyping}
      onBlur={(e) => {
        const next = e.currentTarget.innerText.replace(/ /g, " ").replace(/\n{3,}/g, "\n\n").replace(/[ \t]+$/gm, "").trim();
        // Always reported, even unchanged, so the "still typing" flag clears.
        onCommit(next);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.currentTarget.innerText = value;
          e.currentTarget.blur();
        }
      }}
    />
  );
}

export function PageEditor({
  body,
  readOnly,
  setBlock,
  onTyping,
}: {
  body: AgreementBody;
  readOnly: boolean;
  setBlock: (id: string, patch: { text?: string; title?: string }) => void;
  onTyping: () => void;
}) {
  const v = body.values;
  const work = body.blocks.filter((b) => b.kind === "work");
  const rest = body.blocks.filter((b) => b.kind !== "work");
  const row = (label: string, value: string) => (
    <tr>
      <th>{label}</th>
      <td>{value || <span className="pe-blank">missing</span>}</td>
    </tr>
  );

  return (
    <div className="pe-page" aria-label="The agreement, editable in place">
      <p className="pe-tip">Click any paragraph to edit it. Names, phone numbers and money are set in the form.</p>
      <h1>Customer Agreement &amp; Work Authorization</h1>
      {v.replaces_signed_on && <p className="pe-center"><strong>AMENDED AGREEMENT: replaces the version signed on {longDate(v.replaces_signed_on)}</strong></p>}
      <table className="pe-table">
        <tbody>
          {row("Date", longDate(v.date))}
          {row("Customer", v.customer_name)}
          {row("Phone", v.customer_phone)}
          {row("Job address", v.job_address)}
          {row("Email", v.customer_email)}
          {row("Contractor", v.contractor_name)}
          {v.contractor_license.trim() && row("Contractor license #", v.contractor_license)}
          {row("Contractor phone", v.contractor_phone)}
        </tbody>
      </table>

      <h2>Work to Be Done</h2>
      {work.map((b) => (
        <section key={b.id}>
          <h3>{b.title}</h3>
          <EditableText value={b.text} label={b.title} disabled={readOnly} onTyping={onTyping} onCommit={(t) => setBlock(b.id, { text: t })} />
        </section>
      ))}
      <p className="pe-note">{WORK_NOTE}</p>

      <h2>Price &amp; Payment</h2>
      <table className="pe-table">
        <tbody>
          {row("Total price", `${money(v.total_cents)} ${v.tax_mode === "includes_tax" ? "(includes all sales tax and fees)" : "(plus tax & any permit fees)"}`)}
          {row("Deposit due to schedule", money(v.deposit_cents))}
          {row("Balance due at completion", money(v.total_cents - v.deposit_cents))}
        </tbody>
      </table>

      {rest.map((b) => (
        <section key={b.id}>
          {b.kind === "custom" && !readOnly ? (
            <h2>
              <input className="pe-title" value={b.title} maxLength={120} aria-label="Section title" onChange={(e) => setBlock(b.id, { title: e.target.value })} />
            </h2>
          ) : (
            <h2>{b.title}</h2>
          )}
          <EditableText value={b.text} label={b.title} disabled={readOnly} onTyping={onTyping} onCommit={(t) => setBlock(b.id, { text: t })} />
          {b.kind === "initials" && <p className="pe-note">The customer initials each item when signing.</p>}
        </section>
      ))}

      <div className="pe-sign">
        <p>
          <strong>Customer signature:</strong> <span className="pe-box">Customer signs</span> <strong>Date:</strong> <span className="pe-box pe-box-sm">date</span>
        </p>
        <p>
          <strong>Contractor signature:</strong> <span className="pe-box">Contractor signs</span> <strong>Date:</strong> <span className="pe-box pe-box-sm">date</span>
        </p>
      </div>
    </div>
  );
}
