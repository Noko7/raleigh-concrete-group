import Link from "next/link";

import { METHOD_LABELS, crewIncomeCents, usd, type PaymentMethod } from "@/lib/crm/fees";
import { dict } from "@/lib/crm/i18n";
import { MONEY_WINDOW_DAYS, type MoneyBoard } from "@/lib/crm/money";
import type { Session } from "@/lib/crm/types";
import { CrewJobRows } from "./crew-job-rows";

/**
 * The Money page as a contractor sees it: their own jobs, and nothing else.
 *
 * Built from the same board as the owner's, so every figure here is one the
 * office can see too and the two can be read across a phone call without
 * either side doing sums. RLS has already limited the board to this
 * contractor's jobs; the filter below is belt and braces.
 *
 * Reads as income rather than as fees: what the work is worth to them after
 * the office's cut, what has actually come in, and the one number that needs
 * doing something about - fee still owed on cash jobs.
 */
export function CrewMoney({ session, board, base }: { session: Session; board: MoneyBoard; base: string }) {
  const me = session.staff.id;
  const jobs = board.jobs.filter((j) => j.staffId === me);
  // The per-contractor row, not a sum of the job rows: a fee sent over against
  // a balance rather than one job only reduces it here.
  const mine = board.contractors.find((c) => c.staffId === me);

  const incomeCents = jobs.reduce((sum, j) => sum + crewIncomeCents(j.ledger, j.onBooks), 0);
  const collectedCents = jobs.reduce((sum, j) => sum + j.ledger.paidCents, 0);
  const toCollectCents = jobs.reduce((sum, j) => sum + (j.onBooks ? j.ledger.dueCents : 0), 0);
  const owedCents = mine?.balanceCents ?? 0;
  const t = dict("en");

  return (
    <main className="crm-page crm-page-wide">
      <div className="crm-page-head">
        <div>
          <h1>Money</h1>
          {board.testCount > 0 && (
            <p className="crm-muted crm-sm money-tests">
              {board.includingTests ? (
                <>
                  Practice leads are <strong>in</strong> these figures.{" "}
                  <Link href={`${base}/money`}>Hide the {board.testCount} test {board.testCount === 1 ? "lead" : "leads"}</Link>
                </>
              ) : (
                <>
                  {board.testCount} test {board.testCount === 1 ? "lead is" : "leads are"} left out of the figures
                  below. <Link href={`${base}/money?tests=1`}>Show them</Link>
                </>
              )}
            </p>
          )}
        </div>
      </div>

      {board.truncated.length > 0 && (
        <p className="crm-empty money-truncated">
          <strong>These totals are incomplete.</strong> This page reads the most recent{" "}
          {board.truncated.join(" and ")}, and there are more than it loads.
        </p>
      )}

      <div className="crm-stats">
        <div className="crm-stat">
          <strong>{usd(incomeCents)}</strong>
          <span>Your income, after the office fee</span>
        </div>
        <div className="crm-stat">
          <strong>{usd(collectedCents)}</strong>
          <span>Collected from customers</span>
        </div>
        <div className="crm-stat">
          <strong>{usd(toCollectCents)}</strong>
          <span>Customers still owe you</span>
        </div>
        <div className={`crm-stat${owedCents > 0 ? " cash-stat-owed" : ""}`}>
          <strong>{usd(owedCents)}</strong>
          <span>Fee you still owe the office</span>
        </div>
      </div>

      <CrewJobRows jobs={jobs} base={base} statusLabels={t.status} />

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

      <p className="crm-muted crm-sm cash-note">
        Your income is each job&apos;s total after change orders, less the office fee on it. A card payment pays the
        office its fee on the way past. Cash, check, Zelle and Venmo don&apos;t, so that fee stays owed until you send
        it over. Fee you owe counts every fee you&apos;ve already sent, including any not tied to one job.
      </p>
    </main>
  );
}
