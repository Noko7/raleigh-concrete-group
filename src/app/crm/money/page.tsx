import Link from "next/link";

import { requireOwner } from "@/lib/crm/auth";
import { METHOD_LABELS, usd, type PaymentMethod } from "@/lib/crm/fees";
import { MONEY_WINDOW_DAYS, moneyBoard } from "@/lib/crm/money";
import { crmBase } from "@/lib/crm/nav";
import { listStaff } from "@/lib/crm/queries";
import { SettleForm } from "./settle-form";

export const dynamic = "force-dynamic";

function when(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * The cash board. Owner only.
 *
 * Answers three questions, in the order they get asked: how much money came in,
 * who still owes the office its cut, and which customers haven't finished
 * paying. Everything else on the page is detail underneath one of those three.
 *
 * The fee balance is the number this page exists for, so it is the only one
 * given a colour. Card jobs pay it automatically and never appear there; cash
 * jobs do, and that column is the entire cost of being flexible about how
 * customers pay - stated plainly rather than discovered at the end of a month.
 */
export default async function MoneyPage() {
  const session = await requireOwner();
  const base = await crmBase();
  const staff = await listStaff(session);
  const board = await moneyBoard(session, staff);

  const owedBy = board.contractors.filter((c) => c.balanceCents > 0 && c.staffId);

  return (
    <main className="crm-page crm-page-wide">
      <div className="crm-page-head">
        <h1>Money</h1>
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

      <section className="crm-card">
        <h2 className="crm-card-title">By contractor</h2>
        {board.contractors.length === 0 ? (
          <p className="crm-muted">Nothing has been paid on any job yet.</p>
        ) : (
          <div className="crm-table-wrap">
            <table className="crm-table cash-table">
              <thead>
                <tr>
                  <th>Contractor</th>
                  <th>Jobs paid</th>
                  <th>Collected</th>
                  <th>Of that, cash</th>
                  <th>Your fee earned</th>
                  <th>Taken by Stripe</th>
                  <th>Sent to you</th>
                  <th>Still owed</th>
                </tr>
              </thead>
              <tbody>
                {board.contractors.map((c) => (
                  <tr key={c.staffId ?? "unassigned"}>
                    <td>{c.name}</td>
                    <td>{c.jobs}</td>
                    <td>{usd(c.collectedCents)}</td>
                    <td>{usd(c.offStripeCents)}</td>
                    <td>{usd(c.feeEarnedCents)}</td>
                    <td>{usd(c.feeCollectedCents)}</td>
                    <td>{usd(c.feeSettledCents)}</td>
                    <td className={c.balanceCents > 0 ? "cash-owed" : ""}>{usd(c.balanceCents)}</td>
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

      <section className="crm-card">
        <h2 className="crm-card-title">Customers who still owe</h2>
        {board.owing.length === 0 ? (
          <p className="crm-muted">Every approved job is paid in full.</p>
        ) : (
          <div className="crm-table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Contractor</th>
                  <th>Job total</th>
                  <th>Paid</th>
                  <th>Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {board.owing.map((j) => (
                  <tr key={j.id}>
                    <td>
                      <Link href={`${base}/quotes/${j.id}`}>{j.name}</Link>
                    </td>
                    <td>{j.staffName}</td>
                    <td>{usd(j.ledger.totalCents)}</td>
                    <td>{usd(j.ledger.paidCents)}</td>
                    <td className="cash-owed">{usd(j.ledger.dueCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="crm-card">
        <h2 className="crm-card-title">Recent payments</h2>
        {board.recent.length === 0 ? (
          <p className="crm-muted">Nothing recorded yet.</p>
        ) : (
          <ul className="cash-feed">
            {board.recent.map(({ payment: p, customer }) => (
              <li key={p.id}>
                <span className="cash-feed-when">{when(p.paid_at ?? p.created_at)}</span>
                <span className="cash-feed-who">
                  <Link href={`${base}/quotes/${p.quote_id}`}>{customer}</Link>
                </span>
                <span className="cash-feed-how">{METHOD_LABELS[p.method as PaymentMethod] ?? p.method}</span>
                <span className="cash-feed-amount">
                  {usd(p.amount_cents - p.refunded_cents)}
                  {/* What the office took out of it. Zero on everything that
                      wasn't a card, which is exactly the pattern worth being
                      able to see at a glance down this column. */}
                  {p.fee_cents > 0 && <em>{usd(p.fee_cents)} fee</em>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
