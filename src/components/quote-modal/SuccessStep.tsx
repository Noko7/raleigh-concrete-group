"use client";

import { phoneDisplay, phoneHref } from "@/lib/site-data";
import { IconCheck } from "./icons";
import { prettyDay, type FormState, type Mode } from "./shared";

export function SuccessStep({
  mode,
  visitBooked,
  data,
  filesFailed,
  smsHref,
  leadRef,
  onClose,
}: {
  mode: Mode | null;
  visitBooked: boolean;
  data: FormState;
  filesFailed: number;
  smsHref: string;
  leadRef: string;
  onClose: () => void;
}) {
  return (
<div className="qm-body qm-success">
  <div className="qm-check">
    <IconCheck />
  </div>
  <h2 className="qm-title">You&apos;re all set!</h2>
  <p className="qm-sub">
    {mode === "inperson" && !visitBooked
      ? "We got your request. We'll call or text you shortly to set a time for your visit."
      : "We got your request and we'll reach out soon with your quote. Want to talk now? Give us a call."}
  </p>
  {mode === "inperson" && visitBooked && data.visitDate && (
    <p className="qm-sub">
      Your visit: <strong>{prettyDay(data.visitDate)} at {data.visitTime}</strong>
    </p>
  )}
  {/* Photos never fail a request; missing ones get a way to follow on. */}
  {filesFailed > 0 && (
    <p className="qm-err">
      {filesFailed === 1 ? "One photo" : `${filesFailed} photos`} didn&apos;t upload.{" "}
      <a href={smsHref} className="qm-consent-link">
        Text {filesFailed === 1 ? "it" : "them"} to us
      </a>{" "}
      at {phoneDisplay}.
    </p>
  )}
  {/* The reference is the start of the saved row's id. */}
  <p className="qm-ref">
    Reference <strong>{leadRef}</strong>
  </p>
  <a href={phoneHref} className="cta-primary qm-full">
    Call {phoneDisplay}
  </a>
  <button className="qm-text-btn" onClick={onClose}>
    Close
  </button>
</div>
  );
}
