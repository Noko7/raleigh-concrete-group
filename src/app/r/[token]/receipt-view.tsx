import Image from "next/image";
import Link from "next/link";

import {
  methodLabel,
  payeeName,
  receiptMoney,
  receiptNumberLabel,
  receiptTime,
  type PaymentReceipt,
} from "@/lib/crm/receipt-format";
import { businessName, phoneDisplay } from "@/lib/site-data";
import { PrintButton } from "./print-button";

type Linked = { receipt_number: number; token: string };

/** The receipt itself, from its frozen copy. Separate from the page so it can be checked without a database. */
export function ReceiptView({ r, replaces, replacedBy }: { r: PaymentReceipt; replaces?: Linked; replacedBy?: Linked }) {
  const job = [r.job_service, r.job_address].filter(Boolean).join(", ");

  return (
    <main className="cq-wrap">
      <article className="cq-card rc">
        <header className="cq-head rc-head">
          <Image src="/images/logo_horizontal.png" alt={businessName} width={967} height={243} className="cq-logo" priority />
          <div className="rc-id">
            <span className="rc-kind">Receipt</span>
            <span className="rc-no">{receiptNumberLabel(r.receipt_number)}</span>
          </div>
        </header>

        {r.voided_at && (
          <div className="rc-void" role="status">
            <strong>VOID</strong>
            <span>
              {r.void_reason}. Voided {receiptTime(r.voided_at)}.
              {replacedBy && (
                <>
                  {" "}
                  Replaced by <Link href={`/r/${replacedBy.token}`}>receipt {receiptNumberLabel(replacedBy.receipt_number)}</Link>.
                </>
              )}
            </span>
          </div>
        )}
        {r.is_test && <p className="rc-test">Practice receipt - not a real payment.</p>}

        <section className="rc-amount">
          <span className="rc-label">Amount paid</span>
          <strong className="rc-big">{receiptMoney(r.amount_cents)}</strong>
          <span className="rc-sub">
            {methodLabel(r.method)} · paid {receiptTime(r.paid_at)}
          </span>
        </section>

        <section className="rc-parties">
          <div>
            <span className="rc-label">Paid to</span>
            <strong>{payeeName(r)}</strong>
            {r.paid_to_business_name && <span>{r.paid_to_name}</span>}
            {r.paid_to_business_address && <span>{r.paid_to_business_address}</span>}
            {r.paid_to_phone && <span>{r.paid_to_phone}</span>}
          </div>
          <div>
            <span className="rc-label">Received from</span>
            <strong>{r.customer_name}</strong>
            {job && (
              <>
                <span className="rc-label rc-label-gap">For</span>
                <span>{job}</span>
              </>
            )}
          </div>
        </section>

        {(r.job_total_cents != null || r.balance_cents != null) && (
          <dl className="rc-ledger">
            {r.job_total_cents != null && (
              <div>
                <dt>Job total</dt>
                <dd>{receiptMoney(r.job_total_cents)}</dd>
              </div>
            )}
            {r.paid_to_date_cents != null && (
              <div>
                <dt>Paid so far, including this payment</dt>
                <dd>{receiptMoney(r.paid_to_date_cents)}</dd>
              </div>
            )}
            {r.balance_cents != null && (
              <div className="rc-balance">
                <dt>Balance remaining</dt>
                <dd>{receiptMoney(r.balance_cents)}</dd>
              </div>
            )}
          </dl>
        )}

        <dl className="rc-facts">
          <div>
            <dt>Receipt</dt>
            <dd>{receiptNumberLabel(r.receipt_number)}</dd>
          </div>
          <div>
            <dt>Issued</dt>
            <dd>{receiptTime(r.issued_at)}</dd>
          </div>
          <div>
            <dt>Recorded by</dt>
            <dd>{r.recorded_by_name ?? (r.recorded_by ? "Staff" : "Paid online by card")}</dd>
          </div>
          {replaces && (
            <div>
              <dt>Replaces</dt>
              <dd>
                <Link href={`/r/${replaces.token}`}>Receipt {receiptNumberLabel(replaces.receipt_number)}</Link> (void)
              </dd>
            </div>
          )}
        </dl>

        <p className="rc-note">
          This payment was made to {payeeName(r)}, who did the work. {businessName} arranged the job and keeps this
          receipt on file; it is not a payment to {businessName}.
        </p>

        <div className="rc-acts">
          <a href={`/r/${r.token}/pdf`} className="cq-btn cq-btn-primary">
            Download PDF
          </a>
          <PrintButton />
        </div>
        <p className="rc-foot">
          {businessName} · <a href={`tel:${phoneDisplay.replace(/[^0-9]/g, "")}`}>{phoneDisplay}</a>
        </p>
      </article>
    </main>
  );
}
