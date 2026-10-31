import Link from "next/link";

import { requireSession } from "@/lib/crm/auth";
import { METHOD_LABELS, usd, type PaymentMethod } from "@/lib/crm/fees";
import { MONEY_WINDOW_DAYS, moneyBoard } from "@/lib/crm/money";
import { crmBase } from "@/lib/crm/nav";
import { listStaff } from "@/lib/crm/queries";
import { JobRows } from "./job-rows";
import { CrewMoney } from "./crew-money";
import { LedgerTable } from "./ledger-table";
import { SettleForm } from "./settle-form";

export const dynamic = "force-dynamic";

/**
 * Owner sees the whole business; a contractor sees their own jobs (CrewMoney) from the same board.
 * Order: totals, then anything that makes a total untrustworthy, then the entries they sum.
 * The fee balance is the only coloured figure: card jobs pay it automatically, cash jobs accrue it.
 */
export default async function MoneyPage({
  searchParams,
}: {
  searchParams: Promise<{ tests?: string }>;
}) {
  const session = await requireSession();
  const base = await crmBase();
  const { tests } = await searchParams;
  const includeTests = tests === "1";
  const staff = await listStaff(session);
  const board = await moneyBoard(session, staff, { includeTests });

  if (session.staff.role !== "owner") return <CrewMoney session={session} board={board} base={base} />;

  const owedBy = board.contractors.filter((c) => c.balanceCents > 0 && c.staffId);
  const crew = board.contractors
    .filter((c) => c.staffId)
    .map((c) => ({ id: c.staffId as string, name: c.name }));
  // How much the flagged rows distort the figures, not just that they do.
  const ghostOwing = board.attention
    .filter((a) => a.kind === "paid_no_payments")
    .reduce((sum, a) => sum + a.effectCents, 0);

  return (
    <main className="crm-page crm-page-wide">
      <div className="crm-page-head">
        <div>
          <h1>Money</h1>
          <p className="crm-sm">
            <Link href={`${base}/documents?view=receipts`}>Receipts: every customer payment, numbered, with a CSV for taxes →</Link>
          </p>
          {/* Only shown when something is being left out. */}
          {board.testCount > 0 && (
            <p className="crm-muted crm-sm money-tests">
              {board.includingTests ? (
                <>
                  Practice leads are <strong>in</strong> these figures.{" "}
                  <Link href={`${base}/money`}>Hide the {board.testCount} test {board.testCount === 1 ? "lead" : "leads"}</Link>
                </>
              ) : (
                <>
                  {board.testCount} test {board.testCount === 1 ? "lead is" : "leads are"} left out of every figure
                  below.{" "}
                  <Link href={`${base}/money?tests=1`}>Show them</Link>
                </>
              )}
            </p>
          )}
        </div>
        <SettleForm
          contractors={owedBy.map((c) => ({
            staffId: c.staffId as string,
            name: c.name,
            balanceCents: c.balanceCents,
            jobs: board.jobs
              .filter((j) => j.staffId === c.staffId && j.ledger.feeDueNowCents > 0)
              .sort((a, b) => b.ledger.feeDueNowCents - a.ledger.feeDueNowCents)
              .map((j) => ({ id: j.id, name: j.name, owedCents: j.ledger.feeDueNowCents })),
          }))}
        />
      </div>

      {board.paymentsReadFailed && (
        <p className="crm-empty">
          The payments could not be loaded just now, so the figures on this page leave them out. Reload to try
          again.
        </p>
      )}

      {/* Above the figures, as a warning: a capped read means every total below is too small. */}
      {board.truncated.length > 0 && (
        <p className="crm-empty money-truncated">
          <strong>These totals are incomplete.</strong> This page reads the most recent{" "}
          {board.truncated.join(" and ")} and you now have more than it loads, so every figure below
          is a sum over part of the business rather than all of it. Nothing is wrong with the data -
          the page needs date filtering before it can be trusted again.
        </p>
      )}

      {/* Money in the order it moves; owed-to-you last (it becomes a phone call), then the value quoted. */}
      <div className="crm-stats">
        <div className="crm-stat">
          <strong>{usd(board.collectedCents)}</strong>
          <span>Collected from customers</span>
        </div>
        <div className="crm-stat">
          <strong>{usd(board.outstandingCents)}</strong>
          <span>Customers still owe</span>
        </div>
        <div className="crm-stat">
          <strong>{usd(board.feeCollectedCents + board.feeSettledCents)}</strong>
          <span>Your fees, received</span>
        </div>
        <div className={`crm-stat${board.feeBalanceCents > 0 ? " cash-stat-owed" : ""}`}>
          <strong>{usd(board.feeBalanceCents)}</strong>
          <span>Your fees, still owed to you</span>
        </div>
        {/* Every sent quote, won or not; not subject to the row ceilings. A dash rather than $0 when the read fails. */}
        <div className="crm-stat">
          <strong>{board.quotesSentAllTime ? usd(board.quotesSentAllTime.cents) : "-"}</strong>
          <span>Quotes sent, all time</span>
        </div>
      </div>

      {/* Per customer, not per text: the job pages' "Quotes sent" counts versions, and the two must not be confused. */}
      {board.quotesSentAllTime != null && board.quotesSentAllTime.count > 0 && (
        <p className="crm-muted crm-sm money-quote-note">
          Quotes sent is the total of {board.quotesSentAllTime.count}{" "}
          {board.quotesSentAllTime.count === 1 ? "quote" : "quotes"} at their current price, counting each customer once, however many corrections or extra options they were
          sent afterwards. Retracted quotes are not counted{board.includingTests ? "" : ", and nor are test leads"}.
        </p>
      )}

      {/* Directly under the figures it affects, naming the rows that make them wrong. */}
      {board.attention.length > 0 && (
        <section className="crm-card cash-attention">
          <h2 className="crm-card-title">Check these {board.attention.length} rows</h2>
          <p className="crm-muted crm-sm">
            Every figure above is a sum over jobs, so one job in an odd state is a total that cannot be justified.
            {ghostOwing > 0 && (
              <>
                {" "}
                Right now <strong>{usd(ghostOwing)}</strong> of &ldquo;customers still owe&rdquo; is jobs marked paid
                before this app recorded payments. They were paid; there is simply no record of it here.
              </>
            )}
          </p>
          <div className="crm-table-wrap">
            <table className="crm-table led-table">
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Contractor</th>
                  <th>What is odd about it</th>
                  <th className="led-num">Affects totals by</th>
                </tr>
              </thead>
              <tbody>
                {board.attention.map((a) => (
                  <tr key={`${a.kind}:${a.jobId ?? a.name}`}>
                    <td>
                      {a.jobId && a.kind !== "orphan_payment" ? (
                        <Link href={`${base}/quotes/${a.jobId}`}>{a.name}</Link>
                      ) : (
                        a.name
                      )}
                    </td>
                    <td>{a.staffName}</td>
                    <td>{a.detail}</td>
                    <td className="led-num">{a.effectCents > 0 ? usd(a.effectCents) : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="crm-muted crm-sm cash-note">
            <code>supabase/queries/money-audit.sql</code> lists the same rows straight from the database, and has the
            statements to fix each kind once you have decided what each one should have been.
          </p>
        </section>
      )}

      {/* The split matters: cash doesn't pay the office on its way past. */}
      <section className="crm-card">
        <h2 className="crm-card-title">Last {MONEY_WINDOW_DAYS} days · {usd(board.recentCents)}</h2>
        {board.byMethod.length === 0 ? (
          <p className="crm-muted">No payments in the last {MONEY_WINDOW_DAYS} days.</p>
        ) : (
          <ul className="cash-methods">
            {board.byMethod.map((m) => (
              <li key={m.method}>
                <span>{METHOD_LABELS[m.method as PaymentMethod] ?? m.method}</span>
                <strong>{usd(m.cents)}</strong>
                <i
                  aria-hidden="true"
                  style={{ width: `${board.recentCents > 0 ? Math.round((m.cents / board.recentCents) * 100) : 0}%` }}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <LedgerTable entries={board.entries} base={base} contractors={crew} />

      <JobRows jobs={board.jobs} base={base} />

      <section className="crm-card">
        <h2 className="crm-card-title">By contractor</h2>
        {board.contractors.length === 0 ? (
          <p className="crm-muted">Nothing has been paid on any job yet.</p>
        ) : (
          <div className="crm-table-wrap">
            <table className="crm-table cash-table led-table">
              <thead>
                <tr>
                  <th>Contractor</th>
                  <th className="led-num">Jobs paid</th>
                  <th className="led-num">Job value</th>
                  <th className="led-num">Collected</th>
                  <th className="led-num">Of that, cash</th>
                  <th className="led-num">Your fee earned</th>
                  <th className="led-num">Taken by Stripe</th>
                  <th className="led-num">Sent to you</th>
                  <th className="led-num">Still owed</th>
                </tr>
              </thead>
              <tbody>
                {board.contractors.map((c) => (
                  <tr key={c.staffId ?? "unassigned"}>
                    <td>{c.name}</td>
                    <td className="led-num">{c.jobs}</td>
                    <td className="led-num">{usd(c.jobValueCents)}</td>
                    <td className="led-num">{usd(c.collectedCents)}</td>
                    <td className="led-num">{usd(c.offStripeCents)}</td>
                    <td className="led-num led-fee">{usd(c.feeEarnedCents)}</td>
                    <td className="led-num">{usd(c.feeCollectedCents)}</td>
                    <td className="led-num">{usd(c.feeSettledCents)}</td>
                    <td className={`led-num${c.balanceCents > 0 ? " cash-owed" : ""}`}>{usd(c.balanceCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="crm-muted crm-sm cash-note">
          Your fee is your rate on each job&apos;s whole total after any change orders, owed in full whatever the
          customer has paid so far. A card payment takes your cut on the way past; cash doesn&apos;t, so it lands in the last
          column until the contractor sends it over. Job value is what their open and finished jobs are worth now.
        </p>
      </section>
    </main>
  );
}
