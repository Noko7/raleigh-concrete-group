import Link from "next/link";

import { requireSession } from "@/lib/crm/auth";
import { crmBase } from "@/lib/crm/nav";
import {
  easternYearStartIso,
  methodLabel,
  payeeName,
  receiptMoney,
  receiptNumberLabel,
  receiptTime,
  receiptYear,
} from "@/lib/crm/receipt-format";
import { listReceiptsIssued } from "@/lib/crm/receipts";

export const dynamic = "force-dynamic";

// Every receipt issued in a year, for the books: the owner sees all of them, a contractor the ones naming them
// (RLS). Voided receipts stay in the list, marked, so the numbering has no unexplained gaps. Practice receipts
// are left out of the totals and the export unless asked for.
const FIRST_YEAR = 2026;

export default async function ReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; tests?: string }>;
}) {
  const session = await requireSession();
  const base = await crmBase();
  const sp = await searchParams;
  const thisYear = receiptYear(new Date().toISOString());
  const asked = Number(sp.year);
  const year = Number.isInteger(asked) && asked >= FIRST_YEAR && asked <= thisYear ? asked : thisYear;
  const includeTests = sp.tests === "1";

  const { rows, ok } = await listReceiptsIssued(session, easternYearStartIso(year), easternYearStartIso(year + 1));
  const testCount = rows.filter((r) => r.is_test).length;
  const shown = includeTests ? rows : rows.filter((r) => !r.is_test);
  const live = shown.filter((r) => !r.voided_at);
  const totalCents = live.reduce((sum, r) => sum + r.amount_cents, 0);
  const voidCount = shown.length - live.length;

  const years: number[] = [];
  for (let y = thisYear; y >= FIRST_YEAR; y--) years.push(y);
  const q = (y: number, tests: boolean) => `${base}/money/receipts?year=${y}${tests ? "&tests=1" : ""}`;

  return (
    <main className="crm-page crm-page-wide">
      <div className="crm-breadcrumb">
        <Link href={`${base}/money`}>← Money</Link>
      </div>
      <div className="crm-page-head">
        <div>
          <h1>Receipts</h1>
          <p className="crm-muted crm-sm">
            Every customer payment, numbered in order and kept for good. Times are Eastern.
            {testCount > 0 && (
              <>
                {" "}
                {includeTests ? (
                  <>
                    Practice receipts are <strong>in</strong> this list.{" "}
                    <Link href={q(year, false)}>Hide them</Link>
                  </>
                ) : (
                  <>
                    {testCount} practice {testCount === 1 ? "receipt is" : "receipts are"} left out.{" "}
                    <Link href={q(year, true)}>Show them</Link>
                  </>
                )}
              </>
            )}
          </p>
        </div>
        <a
          className="crm-btn crm-btn-primary"
          href={`${base}/money/receipts/csv?year=${year}${includeTests ? "&tests=1" : ""}`}
        >
          Download {year} as CSV
        </a>
      </div>

      <nav className="rl-years" aria-label="Year">
        {years.map((y) => (
          <Link key={y} href={q(y, includeTests)} className={y === year ? "rl-year rl-year-on" : "rl-year"} aria-current={y === year ? "page" : undefined}>
            {y}
          </Link>
        ))}
      </nav>

      {!ok && <p className="crm-auth-error">Some receipts couldn&apos;t be loaded. Refresh before relying on these figures.</p>}

      <section className="rl-totals" aria-label="Totals">
        <div>
          <span>Received in {year}</span>
          <strong>{receiptMoney(totalCents)}</strong>
        </div>
        <div>
          <span>Receipts</span>
          <strong>{live.length}</strong>
        </div>
        <div>
          <span>Void</span>
          <strong>{voidCount}</strong>
        </div>
      </section>

      {shown.length === 0 ? (
        <p className="crm-muted">No receipts issued in {year}.</p>
      ) : (
        <div className="rl-table-wrap">
          <table className="rl-table">
            <thead>
              <tr>
                <th>Receipt</th>
                <th>Paid</th>
                <th>Customer</th>
                <th>Job</th>
                <th>Paid to</th>
                <th>Method</th>
                <th className="rl-num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {[...shown]
                .sort((a, b) => b.receipt_number - a.receipt_number)
                .map((r) => (
                  <tr key={r.id} className={r.voided_at ? "rl-void" : undefined}>
                    <td>
                      <a href={`/r/${r.token}`} target="_blank" rel="noreferrer">
                        {receiptNumberLabel(r.receipt_number)}
                      </a>
                      {r.voided_at && <span className="rl-tag" title={r.void_reason ?? undefined}>Void</span>}
                      {r.is_test && <span className="rl-tag">Practice</span>}
                    </td>
                    <td>{receiptTime(r.paid_at)}</td>
                    <td>
                      <Link href={`${base}/quotes/${r.quote_id}`}>{r.customer_name}</Link>
                    </td>
                    <td>{[r.job_service, r.job_address].filter(Boolean).join(", ")}</td>
                    <td>{payeeName(r)}</td>
                    <td>{methodLabel(r.method)}</td>
                    <td className="rl-num">{receiptMoney(r.amount_cents)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
