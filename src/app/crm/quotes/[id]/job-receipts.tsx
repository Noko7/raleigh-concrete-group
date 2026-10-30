"use client";

import { useActionState } from "react";

import { dict, fill, type Locale } from "@/lib/crm/i18n";
import {
  methodLabel,
  receiptMoney,
  receiptNumberLabel,
  receiptTime,
  type JobReceiptRow,
} from "@/lib/crm/receipt-format";
import { issueReceiptForPayment, type PaymentState } from "./payment-actions";

// A job's receipts, newest first, on the owner's job page (dark) and the crew's (light). Each opens the
// receipt itself in a new tab, where it can be printed or downloaded. The owner also sees any paid payment
// with no receipt, and can issue one.
export type MissingReceiptRow = { paymentId: string; amount_cents: number; method: string; paid_at: string };

const initial: PaymentState = { ok: false };

export function JobReceipts({
  quoteId,
  locale,
  receipts,
  missing = [],
  tone = "dark",
}: {
  quoteId: string;
  locale: Locale;
  receipts: JobReceiptRow[];
  missing?: MissingReceiptRow[];
  tone?: "dark" | "light";
}) {
  const t = dict(locale).receipts;
  const [state, action, issuing] = useActionState(issueReceiptForPayment, initial);
  const box = tone === "light" ? "js-card jr jr-light" : "crm-card jr";

  return (
    <section className={box} aria-label={t.title}>
      <h2 className={tone === "light" ? "js-title" : "crm-card-title"}>{t.title}</h2>
      <p className="jr-lead">{receipts.length ? t.lead : t.empty}</p>

      {receipts.length > 0 && (
        <ul className="jr-list">
          {[...receipts]
            .sort((a, b) => b.receipt_number - a.receipt_number)
            .map((r) => (
              <li key={r.id} className={r.voided_at ? "jr-row jr-void" : "jr-row"}>
                <a href={`/r/${r.token}`} target="_blank" rel="noreferrer" className="jr-no">
                  {receiptNumberLabel(r.receipt_number)}
                </a>
                <span className="jr-amt">{receiptMoney(r.amount_cents)}</span>
                <span className="jr-meta">
                  {methodLabel(r.method)} · {receiptTime(r.issued_at)}
                  {r.replaces_number != null && ` · ${fill(t.replaces, { n: receiptNumberLabel(r.replaces_number) })}`}
                </span>
                <span className="jr-meta">
                  {r.voided_at ? (
                    <strong className="jr-tag-void">
                      {t.void}
                      {r.void_reason ? `: ${r.void_reason}` : ""}
                    </strong>
                  ) : r.customer_copy_sent_at ? (
                    t.texted
                  ) : (
                    t.notTexted
                  )}
                </span>
                <a href={`/r/${r.token}/pdf`} target="_blank" rel="noreferrer" className="jr-pdf">
                  {t.pdf}
                </a>
              </li>
            ))}
        </ul>
      )}

      {missing.length > 0 && (
        <div className="jr-missing">
          <h3>{t.missingTitle}</h3>
          <p className="jr-lead">{t.missingLead}</p>
          <ul className="jr-list">
            {missing.map((m) => (
              <li key={m.paymentId} className="jr-row">
                <span className="jr-amt">{receiptMoney(m.amount_cents)}</span>
                <span className="jr-meta">
                  {methodLabel(m.method)} · {receiptTime(m.paid_at)}
                </span>
                <form action={action}>
                  <input type="hidden" name="id" value={quoteId} />
                  <input type="hidden" name="payment_id" value={m.paymentId} />
                  <button type="submit" className="crm-btn crm-btn-ghost" disabled={issuing}>
                    {issuing ? t.issuing : t.issue}
                  </button>
                </form>
              </li>
            ))}
          </ul>
          {state.message && !issuing && <p className="jr-ok">{state.message}</p>}
          {state.error && !issuing && <p className="jr-err">{state.error}</p>}
        </div>
      )}
    </section>
  );
}
