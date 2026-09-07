"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { METHOD_LABELS, usd, type PaymentMethod } from "@/lib/crm/fees";
import type { JobMoney } from "@/lib/crm/money";

// Every approved job with money attached to it, and what that money did.
//
// The page used to list only the jobs that still owed something, which answers
// "who do I chase" and nothing else. The question underneath it - what is this
// job worth, what has come in, what did the office take, what is left - had no
// home, so it got worked out on a phone call with a contractor reading numbers
// off his own screen.
//
// A row opens rather than navigates: the whole point is comparing one job with
// the ones around it, and a page load loses that.

function day(iso: string | null) {
  if (!iso) return "-";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

type Filter = "owing" | "all" | "settled";

export function JobRows({ jobs, base }: { jobs: JobMoney[]; base: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("owing");

  const rows = useMemo(() => {
    const list = jobs.filter((j) => {
      // Same rule as the figure at the top of the page: a job that left the
      // pipeline is not a customer anybody is chasing, whatever its balance.
      if (filter === "owing") return j.onBooks && j.ledger.dueCents > 0;
      if (filter === "settled") return j.ledger.dueCents === 0 && j.ledger.paidCents > 0;
      return true;
    });
    // Most owed first while chasing, most recent first when browsing: the sort
    // follows what the filter says you are doing.
    return filter === "owing"
      ? [...list].sort((a, b) => b.ledger.dueCents - a.ledger.dueCents)
      : [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [jobs, filter]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, j) => ({
          total: acc.total + j.ledger.totalCents,
          paid: acc.paid + j.ledger.paidCents,
          due: acc.due + (j.onBooks ? j.ledger.dueCents : 0),
          fee: acc.fee + j.ledger.feeTotalCents,
        }),
        { total: 0, paid: 0, due: 0, fee: 0 },
      ),
    [rows],
  );

  return (
    <section className="crm-card">
      <div className="led-head">
        <h2 className="crm-card-title">Jobs</h2>
        <div className="led-filters">
          {(["owing", "settled", "all"] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              className={`led-chip${filter === f ? " led-chip-on" : ""}`}
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
            >
              {f === "owing" ? "Still owing" : f === "settled" ? "Paid in full" : "Every job"}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="crm-muted">
          {filter === "owing" ? "Every approved job is paid in full." : "Nothing to show here yet."}
        </p>
      ) : (
        <div className="crm-table-wrap led-wrap">
          <table className="crm-table led-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Contractor</th>
                <th className="led-num">Job</th>
                <th className="led-num">Paid</th>
                <th className="led-num">Outstanding</th>
                <th className="led-num">Your fee</th>
                <th aria-label="Detail" />
              </tr>
            </thead>
            <tbody>
              {rows.map((j) => {
                const isOpen = open === j.id;
                return [
                  <tr key={j.id} className={isOpen ? "led-row-open" : ""}>
                    <td>
                      <Link href={`${base}/quotes/${j.id}`}>{j.name}</Link>
                      <span className="led-sub">
                        {j.status}
                        {/* It took money and then left the pipeline. Its cash
                            is still in the takings; its balance is nobody's to
                            chase. Worth saying on the row, because the numbers
                            beside it follow a different rule from the rest. */}
                        {j.isTest && <em className="led-offbooks">test</em>}
                        {!j.onBooks && <em className="led-offbooks">off the books</em>}
                      </span>
                    </td>
                    <td>{j.staffName}</td>
                    <td className="led-num">{usd(j.ledger.totalCents)}</td>
                    <td className="led-num">{usd(j.ledger.paidCents)}</td>
                    <td className={`led-num${j.onBooks && j.ledger.dueCents > 0 ? " cash-owed" : ""}`}>
                      {j.onBooks ? usd(j.ledger.dueCents) : "-"}
                    </td>
                    <td className="led-num led-fee">{usd(j.ledger.feeTotalCents)}</td>
                    <td className="led-num">
                      <button
                        type="button"
                        className="led-expand"
                        aria-expanded={isOpen}
                        onClick={() => setOpen(isOpen ? null : j.id)}
                      >
                        {isOpen ? "Hide" : `${j.payments.length || "no"} ${j.payments.length === 1 ? "payment" : "payments"}`}
                      </button>
                    </td>
                  </tr>,
                  isOpen && (
                    <tr key={`${j.id}:detail`} className="led-detail-row">
                      <td colSpan={7}>
                        {j.payments.length === 0 ? (
                          <p className="crm-muted crm-sm">
                            No payments recorded against this job.
                            {j.status === "paid" && " It is marked Paid, which is why the totals above disagree with it."}
                          </p>
                        ) : (
                          <table className="led-inner">
                            <thead>
                              <tr>
                                <th>Date</th>
                                <th>Method</th>
                                <th>Status</th>
                                <th className="led-num">Amount</th>
                                <th className="led-num">Refunded</th>
                                <th className="led-num">Your fee</th>
                                <th>Note</th>
                              </tr>
                            </thead>
                            <tbody>
                              {j.payments.map((p) => (
                                <tr key={p.id}>
                                  <td className="led-when">{day(p.paid_at ?? p.created_at)}</td>
                                  <td>{METHOD_LABELS[p.method as PaymentMethod] ?? p.method}</td>
                                  <td>{p.status}</td>
                                  <td className="led-num">{usd(p.amount_cents)}</td>
                                  <td className="led-num">{p.refunded_cents > 0 ? usd(p.refunded_cents) : "-"}</td>
                                  <td className="led-num led-fee">{p.fee_cents > 0 ? usd(p.fee_cents) : "-"}</td>
                                  <td className="led-note">{p.note ?? ""}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>
                  {rows.length} {rows.length === 1 ? "job" : "jobs"}
                </td>
                <td className="led-num">{usd(totals.total)}</td>
                <td className="led-num">{usd(totals.paid)}</td>
                <td className={`led-num${totals.due > 0 ? " cash-owed" : ""}`}>{usd(totals.due)}</td>
                <td className="led-num led-fee">{usd(totals.fee)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
