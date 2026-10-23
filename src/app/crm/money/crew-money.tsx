import Link from "next/link";

import { crewIncomeCents, usd, type PaymentMethod } from "@/lib/crm/fees";
import { dict, fill } from "@/lib/crm/i18n";
import { MONEY_WINDOW_DAYS, type MoneyBoard } from "@/lib/crm/money";
import type { Session } from "@/lib/crm/types";
import { CrewJobRows } from "./crew-job-rows";

/**
 * The contractor's Money page, from the same board as the owner's so both sides read the same figures.
 * RLS already limits it to their jobs; the filter below is belt and braces.
 * Reads as income: worth after the office's cut, what came in, and fee still owed on cash jobs.
 */
export function CrewMoney({ session, board, base }: { session: Session; board: MoneyBoard; base: string }) {
  const me = session.staff.id;
  const jobs = board.jobs.filter((j) => j.staffId === me);
  // The per-contractor row, not a sum of job rows: a settlement against the balance only reduces it here.
  const mine = board.contractors.find((c) => c.staffId === me);

  const incomeCents = jobs.reduce((sum, j) => sum + crewIncomeCents(j.ledger, j.onBooks), 0);
  const collectedCents = jobs.reduce((sum, j) => sum + j.ledger.paidCents, 0);
  const toCollectCents = jobs.reduce((sum, j) => sum + (j.onBooks ? j.ledger.dueCents : 0), 0);
  const owedCents = mine?.balanceCents ?? 0;
  const t = dict(session.staff.locale);
  const m = t.crewMoney;

  return (
    <main className="crm-page crm-page-wide">
      <div className="crm-page-head">
        <div>
          <h1>{m.title}</h1>
          {board.testCount > 0 && (
            <p className="crm-muted crm-sm money-tests">
              {board.includingTests ? (
                <>
                  {m.testsIn}{" "}
                  <Link href={`${base}/money`}>
                    {board.testCount === 1 ? m.testsInLinkOne : fill(m.testsInLink, { n: board.testCount })}
                  </Link>
                </>
              ) : (
                <>
                  {board.testCount === 1 ? m.testsOutOne : fill(m.testsOut, { n: board.testCount })}{" "}
                  <Link href={`${base}/money?tests=1`}>{m.testsOutLink}</Link>
                </>
              )}
            </p>
          )}
        </div>
      </div>

      {board.truncated.length > 0 && (
        <p className="crm-empty money-truncated">
          <strong>{m.truncatedLead}</strong>{" "}
          {fill(m.truncated, { what: board.truncated.join(` ${m.truncatedAnd} `) })}
        </p>
      )}

      <div className="crm-stats">
        <div className="crm-stat">
          <strong>{usd(incomeCents)}</strong>
          <span>{m.income}</span>
        </div>
        <div className="crm-stat">
          <strong>{usd(collectedCents)}</strong>
          <span>{m.collected}</span>
        </div>
        <div className="crm-stat">
          <strong>{usd(toCollectCents)}</strong>
          <span>{m.stillOwed}</span>
        </div>
        <div className={`crm-stat${owedCents > 0 ? " cash-stat-owed" : ""}`}>
          <strong>{usd(owedCents)}</strong>
          <span>{m.feeOwed}</span>
        </div>
      </div>

      <CrewJobRows jobs={jobs} base={base} statusLabels={t.status} locale={session.staff.locale} />

      <section className="crm-card">
        <h2 className="crm-card-title">
          {fill(m.recent, { days: MONEY_WINDOW_DAYS })} · {usd(board.recentCents)}
        </h2>
        {board.byMethod.length === 0 ? (
          <p className="crm-muted">{fill(m.recentNone, { days: MONEY_WINDOW_DAYS })}</p>
        ) : (
          <ul className="cash-methods">
            {board.byMethod.map((row) => (
              <li key={row.method}>
                <span>{t.payments.methods[row.method as PaymentMethod] ?? row.method}</span>
                <strong>{usd(row.cents)}</strong>
                <i
                  aria-hidden="true"
                  style={{ width: `${board.recentCents > 0 ? Math.round((row.cents / board.recentCents) * 100) : 0}%` }}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="crm-muted crm-sm cash-note">{m.note}</p>
    </main>
  );
}
