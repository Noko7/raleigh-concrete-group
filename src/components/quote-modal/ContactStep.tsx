"use client";

import type { Dispatch, SetStateAction } from "react";
import { AddressAutocomplete } from "./AddressAutocomplete";
import { isValidPhone, StepHead, type FormState } from "./shared";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// (919) 555-0123 while adding digits only (formatting on backspace re-adds what they deleted). Anything
// that isn't a plain 10-digit number is left as typed.
function formatPhone(next: string, prev: string): string {
  if (next.length < prev.length) return next;
  const d = next.replace(/\D/g, "");
  if (d.length === 0 || d.length > 10 || d.startsWith("1")) return next;
  if (d.length < 4) return d.length === 3 ? `(${d}) ` : `(${d}`;
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}
function isValidEmail(email: string): boolean {
  return email === "" || EMAIL_RE.test(email);
}

export function ContactStep({
  totalSteps,
  data,
  set,
  addressVerified,
  setAddressVerified,
  errorMsg,
  honeypot,
  setHoneypot,
}: {
  totalSteps: number;
  data: FormState;
  set: (patch: Partial<FormState>) => void;
  addressVerified: boolean;
  setAddressVerified: Dispatch<SetStateAction<boolean>>;
  errorMsg: string;
  honeypot: string;
  setHoneypot: Dispatch<SetStateAction<string>>;
}) {
  return (
    <div className="qm-body">
      <StepHead n={1} of={totalSteps} title="Your details" />
      <label className="qm-label" htmlFor="qm-name">Your name</label>
      <input data-clarity-mask="true"
        id="qm-name"
        className="qm-input"
        value={data.name}
        onChange={(e) => set({ name: e.target.value })}
        autoComplete="name"
        maxLength={120}
        placeholder="First and last name"
        enterKeyHint="next"
      />
      <label className="qm-label qm-mt" htmlFor="qm-phone">Mobile number</label>
      <input data-clarity-mask="true"
        id="qm-phone"
        className="qm-input"
        type="tel"
        value={data.phone}
        onChange={(e) => set({ phone: formatPhone(e.target.value, data.phone) })}
        enterKeyHint="next"
        autoComplete="tel"
        maxLength={32}
        inputMode="tel"
        placeholder="(919) 555-0123"
      />
      {/* Fixed-height slot so the address field below doesn't move when the error shows. */}
      <span className="qm-ac-status qm-slot">
        {data.phone.trim() !== "" && !isValidPhone(data.phone) ? "Enter a 10-digit number, like (919) 555-0123." : ""}
      </span>
      <label className="qm-label">Address of the job</label>
      <AddressAutocomplete
        value={data.address}
        verified={addressVerified}
        onChange={(v) => set({ address: v })}
        onVerifiedChange={setAddressVerified}
      />
      <label className="qm-label" htmlFor="qm-email">
        Email <span className="qm-optional">optional</span>
      </label>
      <input data-clarity-mask="true"
        id="qm-email"
        className="qm-input"
        type="email"
        value={data.email}
        onChange={(e) => set({ email: e.target.value })}
        autoComplete="email"
        maxLength={200}
        placeholder="you@email.com"
      />
      <span className="qm-ac-status qm-slot">
        {!isValidEmail(data.email) ? "That email doesn't look right. Check it, or leave it blank." : ""}
      </span>

      {/* Server-side contact rejections land here, on the step that can fix them. */}
      {errorMsg && <p className="qm-err">{errorMsg}</p>}

      {/*
        Trap field. Label and name must be nothing autofill recognises: autofill fills "Company" from saved
        addresses, turning real customers into bots.
      */}
      <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", top: "auto", height: 0, width: 0, overflow: "hidden" }}>
        <label>
          Leave this empty
          <input data-clarity-mask="true"
            type="text"
            name="rcg_leave_blank"
            tabIndex={-1}
            autoComplete="off"
            data-1p-ignore="true"
            data-lpignore="true"
            data-bwignore="true"
            data-form-type="other"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
          />
        </label>
      </div>
    </div>
  );
}
