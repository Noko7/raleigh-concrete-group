import Link from "next/link";

import { requireOwner } from "@/lib/crm/auth";
import { METHOD_LABELS, usd, type PaymentMethod } from "@/lib/crm/fees";
import { MONEY_WINDOW_DAYS, moneyBoard } from "@/lib/crm/money";
import { crmBase } from "@/lib/crm/nav";
import { listStaff } from "@/lib/crm/queries";
import { JobRows } from "./job-rows";
import { LedgerTable } from "./ledger-table";
import { SettleForm } from "./settle-form";

export const dynamic = "force-dynamic";

/**
 * The cash board. Owner only.
 *
 * Reads top to bottom as an accounts page should: what the totals are, then
 * anything that makes a total untrustworthy, then the entries those totals are
 * sums of. Nothing on it is a figure you cannot open and check.
 *
 * The fee balance is the number this page exists for, so it is the only one
 * given a colour. Card jobs pay it automatically and never appear there; cash
 * jobs do, and that column is the entire cost of being flexible about how
 * customers pay - stated plainly rather than discovered at the end of a month.
 */
export default async function MoneyPage({
  searchParams,
}: {
  searchParams: Promise<{ tests?: string }>;
}) {
  const session = await requireOwner();
  const base = await crmBase();
  const { tests } = await searchParams;
  const includeTests = tests === "1";
  const staff = await listStaff(session);
  const board = await moneyBoard(session, staff, { includeTests });

  const owedBy = board.contractors.filter((c) => c.balanceCents > 0 && c.staffId);
  const crew = board.contractors
    .filter((c) => c.staffId)
    .map((c) => ({ id: c.staffId as string, name: c.name }));
  // What the flagged rows are doing to the figures above them, so the panel can
  // say how wrong the page is rather than only that it is wrong somewhere.
  const ghostOwing = board.attention
    .filter((a) => a.kind === "paid_no_payments")
    .reduce((sum, a) => sum + a.effectCents, 0);

  return (
    <main className="crm-page crm-page-wide">
      <div className="crm-page-head">
        <div>
          <h1>Money</h1>
          {/* Only ever rendered when there is something being left out. A
              switch for a state you are not in is one more thing to read. */}
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
          }))}
        />
      </div>

      {board.missingTables && (
        <p className="crm-empty">
          The payments tables aren&apos;t there yet. Run <code>supabase/payments.sql</code> in the Supabase SQL editor
          and this page fills itself in.
        </p>
      )}

      {/* Above the figures, not below them, and worded as a warning rather than
          a note: every total on this page is a sum over rows, so a read that
          came back at its ceiling means the numbers underneath are too small.
          Somebody reconciling against a bank statement has to know that before
          they read the first one, not after. */}
      {board.truncated.length > 0 && (
        <p className="crm-empty money-truncated">
          <strong>These totals are incomplete.</strong> This page reads the most recent{" "}
          {board.truncated.join(" and ")} and you now have more than it loads, so every figure below
          is a sum over part of the business rather than all of it. Nothing is wrong with the data -
          the page needs date filtering before it can be trusted again.
        </p>
      )}

      {/* The four figures the business actually runs on. Owed-to-you last,
          because it is the one that turns into a phone call. */}
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
      </div>

      {/* Directly under the figures it is about. A page that quietly reports a
          wrong number is worse than one that reports a wrong number and says
          which rows made it wrong, and this is the second kind. */}
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
            <code>supabase/money-audit.sql</code> lists the same rows straight from the database, and has the
            statements to fix each kind once you have decided what each one should have been.
          </p>
        </section>
      )}

      {/* How the money arrived. The whole reason to look at this is the split:
          the cash half is the half that doesn't pay the office on its way past. */}
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
          Fees are earned as the customer pays, never before. A card payment takes the office&apos;s cut on the way
          past; cash doesn&apos;t, so it lands in the last column until the contractor sends it over.
        </p>
      </section>
    </main>
  );
}
