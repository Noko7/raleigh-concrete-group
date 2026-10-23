"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { crewIncomeCents, usd, type PaymentMethod } from "@/lib/crm/fees";
import { dict, fill, intlLocale } from "@/lib/crm/i18n";
import type { JobMoney } from "@/lib/crm/money";

// The owner's arithmetic read from the crew's side: job value, office cut, theirs, and how much has come
// in. Same ledger function, so figures can't disagree with the owner's board or the job page.

function day(iso: string | null, locale: string) {
  if (!iso) return "-";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "-"
    : d.toLocaleDateString(intlLocale(locale), { month: "short", day: "numeric", year: "numeric" });
}

type Filter = "all" | "owing" | "settled";

export function CrewJobRows({
  jobs,
  base,
  statusLabels,
  locale,
}: {
  jobs: JobMoney[];
  base: string;
  statusLabels: Record<string, string>;
  locale: string;
}) {
  const t = dict(locale);
  const m = t.crewMoney;
  const payStatus: Record<string, string> = {
    pending: m.payStatusPending,
    paid: m.payStatusPaid,
    failed: m.payStatusFailed,
    refunded: m.payStatusRefunded,
    voided: m.payStatusVoided,
  };
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
        <h2 className="crm-card-title">{m.byJob}</h2>
        <div className="led-filters">
          {(["all", "owing", "settled"] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              className={`led-chip${filter === f ? " led-chip-on" : ""}`}
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
            >
              {f === "owing" ? m.filterOwing : f === "settled" ? m.filterSettled : m.filterAll}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="crm-muted">
          {filter === "owing"
            ? m.emptyOwing
            : filter === "settled"
              ? m.emptySettled
              : m.emptyAll}
        </p>
      ) : (
        <div className="crm-table-wrap led-wrap">
          <table className="crm-table led-table">
            <thead>
              <tr>
                <th>{m.colCustomer}</th>
                <th className="led-num">{m.colJob}</th>
                <th className="led-num">{m.colFee}</th>
                <th className="led-num">{m.colIncome}</th>
                <th className="led-num">{m.colCollected}</th>
                <th className="led-num">{m.colDue}</th>
                <th className="led-num">{m.colFeeOwed}</th>
                <th aria-label={m.colDetail} />
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
                        {statusLabels[j.status] ?? j.status} · {day(j.createdAt, locale)}
                        {j.isTest && <em className="led-offbooks">{m.tagTest}</em>}
                        {!j.onBooks && <em className="led-offbooks">{m.tagClosed}</em>}
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
                        {isOpen
                          ? m.hide
                          : j.payments.length === 0
                            ? m.paymentsNone
                            : j.payments.length === 1
                              ? m.paymentsOne
                              : fill(m.paymentsMany, { n: j.payments.length })}
                      </button>
                    </td>
                  </tr>,
                  isOpen && (
                    <tr key={`${j.id}:detail`} className="led-detail-row">
                      <td colSpan={8}>
                        {j.payments.length === 0 ? (
                          <p className="crm-muted crm-sm">{m.noPayments}</p>
                        ) : (
                          <table className="led-inner">
                            <thead>
                              <tr>
                                <th>{m.colDate}</th>
                                <th>{m.colMethod}</th>
                                <th>{m.colStatus}</th>
                                <th className="led-num">{m.colAmount}</th>
                                <th className="led-num">{m.colRefunded}</th>
                                <th className="led-num">{m.colFeeTaken}</th>
                                <th>{m.colNote}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {j.payments.map((p) => (
                                <tr key={p.id}>
                                  <td className="led-when">{day(p.paid_at ?? p.created_at, locale)}</td>
                                  <td>{t.payments.methods[p.method as PaymentMethod] ?? p.method}</td>
                                  <td>{payStatus[p.status] ?? p.status}</td>
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
                  {rows.length === 1 ? m.jobsOne : fill(m.jobsMany, { n: rows.length })}
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
