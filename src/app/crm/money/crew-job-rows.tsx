"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { METHOD_LABELS, crewIncomeCents, usd, type PaymentMethod } from "@/lib/crm/fees";
import type { JobMoney } from "@/lib/crm/money";

// A contractor's own jobs, and what each one is worth to them.
//
// The owner's table answers "what did the office take"; this one answers the
// crew's question, which is the same arithmetic read from the other side: the
// job is worth this, the office's cut is that, so this much is yours - and of
// it, this much has come in and this much is still with the customer.
//
// Same ledger, same function, so a figure here can never disagree with the
// owner's board or with the job's own page.

function day(iso: string | null) {
  if (!iso) return "-";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

type Filter = "all" | "owing" | "settled";

export function CrewJobRows({
  jobs,
  base,
  statusLabels,
}: {
  jobs: JobMoney[];
  base: string;
  statusLabels: Record<string, string>;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  const rows = useMemo(() => {
    const list = jobs.filter((j) => {
      if (filter === "owing") return j.onBooks && j.ledger.dueCents > 0;
      if (filter === "settled") return j.ledger.dueCents === 0 && j.ledger.paidCents > 0;
      return true;
    });
    return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [jobs, filter]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, j) => ({
          total: acc.total + j.ledger.totalCents,
          fee: acc.fee + j.ledger.feeTotalCents,
          income: acc.income + crewIncomeCents(j.ledger, j.onBooks),
          paid: acc.paid + j.ledger.paidCents,
          due: acc.due + (j.onBooks ? j.ledger.dueCents : 0),
          feeOwed: acc.feeOwed + j.ledger.feeDueNowCents,
        }),
        { total: 0, fee: 0, income: 0, paid: 0, due: 0, feeOwed: 0 },
      ),
    [rows],
  );

  return (
    <section className="crm-card">
      <div className="led-head">
        <h2 className="crm-card-title">Income by job</h2>
        <div className="led-filters">
          {(["all", "owing", "settled"] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              className={`led-chip${filter === f ? " led-chip-on" : ""}`}
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
            >
              {f === "owing" ? "Still to collect" : f === "settled" ? "Paid in full" : "Every job"}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="crm-muted">
          {filter === "owing"
            ? "Every customer of yours has paid in full."
            : filter === "settled"
              ? "No job of yours is paid in full yet."
              : "Once a customer approves one of your jobs, it shows up here."}
        </p>
      ) : (
        <div className="crm-table-wrap led-wrap">
          <table className="crm-table led-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th className="led-num">Job</th>
                <th className="led-num">Office fee</th>
                <th className="led-num">Your income</th>
                <th className="led-num">Collected</th>
                <th className="led-num">Still to collect</th>
                <th className="led-num">Fee you owe</th>
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
                        {statusLabels[j.status] ?? j.status} · {day(j.createdAt)}
                        {j.isTest && <em className="led-offbooks">test</em>}
                        {!j.onBooks && <em className="led-offbooks">closed</em>}
                      </span>
                    </td>
                    <td className="led-num">{usd(j.ledger.totalCents)}</td>
                    <td className="led-num">{j.ledger.feeTotalCents > 0 ? usd(j.ledger.feeTotalCents) : "-"}</td>
                    <td className="led-num led-fee">{usd(crewIncomeCents(j.ledger, j.onBooks))}</td>
                    <td className="led-num">{usd(j.ledger.paidCents)}</td>
                    <td className="led-num">{j.onBooks ? usd(j.ledger.dueCents) : "-"}</td>
                    <td className={`led-num${j.ledger.feeDueNowCents > 0 ? " cash-owed" : ""}`}>
                      {j.ledger.feeDueNowCents > 0 ? usd(j.ledger.feeDueNowCents) : "-"}
                    </td>
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
                      <td colSpan={8}>
                        {j.payments.length === 0 ? (
                          <p className="crm-muted crm-sm">No payments recorded on this job yet.</p>
                        ) : (
                          <table className="led-inner">
                            <thead>
                              <tr>
                                <th>Date</th>
                                <th>Method</th>
                                <th>Status</th>
                                <th className="led-num">Amount</th>
                                <th className="led-num">Refunded</th>
                                <th className="led-num">Office fee taken</th>
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
                                  <td className="led-num">{p.fee_cents > 0 ? usd(p.fee_cents) : "-"}</td>
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
                <td>
                  {rows.length} {rows.length === 1 ? "job" : "jobs"}
                </td>
                <td className="led-num">{usd(totals.total)}</td>
                <td className="led-num">{usd(totals.fee)}</td>
                <td className="led-num led-fee">{usd(totals.income)}</td>
                <td className="led-num">{usd(totals.paid)}</td>
                <td className="led-num">{usd(totals.due)}</td>
                <td className={`led-num${totals.feeOwed > 0 ? " cash-owed" : ""}`}>{usd(totals.feeOwed)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
