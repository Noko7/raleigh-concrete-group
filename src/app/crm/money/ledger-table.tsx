"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { METHOD_LABELS, usd, type PaymentMethod } from "@/lib/crm/fees";
import type { LedgerEntry } from "@/lib/crm/money";

// Every movement of money, newest first: payments, refunds, and settlements (a contractor handing over a
// cash job's cut). One list so every total can be opened.
// Amounts right-aligned with tabular figures; hairlines rather than stripes (hover and expand state).

const KIND_LABEL: Record<LedgerEntry["kind"], string> = {
  payment: "Payment",
  refund: "Refund",
  settlement: "Fee sent to you",
};

function day(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "-"
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
}

type Window = "30" | "90" | "all";

export function LedgerTable({
  entries,
  base,
  contractors,
}: {
  entries: LedgerEntry[];
  base: string;
  contractors: { id: string; name: string }[];
}) {
  const [who, setWho] = useState("");
  const [job, setJob] = useState("");
  const [kind, setKind] = useState("");
  const [window, setWindow] = useState<Window>("90");

  const rows = useMemo(() => {
    const since = window === "all" ? 0 : Date.now() - Number(window) * 86_400_000;
    return entries.filter((e) => {
      if (who && (e.staffId ?? "") !== who) return false;
      if (job && e.jobId !== job) return false;
      if (kind && e.kind !== kind) return false;
      if (since && new Date(e.at).getTime() < since) return false;
      return true;
    });
  }, [entries, who, job, kind, window]);

  // For reading one job's whole history in one place.
  const jobs = useMemo(() => {
    const seen = new Map<string, string>();
    for (const e of entries) if (e.jobId && !seen.has(e.jobId)) seen.set(e.jobId, e.customer);
    return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [entries]);

  // Footed so the columns can be checked against a bank statement.
  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, e) => ({
          in: acc.in + e.amountCents,
          fee: acc.fee + e.feeCents,
          crew: acc.crew + e.amountCents - e.feeCents,
        }),
        { in: 0, fee: 0, crew: 0 },
      ),
    [rows],
  );

  return (
    <section className="crm-card">
      <div className="led-head">
        <h2 className="crm-card-title">Ledger</h2>
        <div className="led-filters">
          <label className="led-filter">
            <span>Job</span>
            <select value={job} onChange={(e) => setJob(e.target.value)}>
              <option value="">Every job</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.name}
                </option>
              ))}
            </select>
          </label>
          <label className="led-filter">
            <span>Contractor</span>
            <select value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="">Everyone</option>
              {contractors.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="led-filter">
            <span>Type</span>
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">Everything</option>
              <option value="payment">Payments</option>
              <option value="refund">Refunds</option>
              <option value="settlement">Fees sent to you</option>
            </select>
          </label>
          <label className="led-filter">
            <span>Since</span>
            <select value={window} onChange={(e) => setWindow(e.target.value as Window)}>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="all">All time</option>
            </select>
          </label>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="crm-muted">Nothing in this range. Try a longer window.</p>
      ) : (
        <>
          <div className="crm-table-wrap led-wrap">
            <table className="crm-table led-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Job</th>
                  <th>Type</th>
                  <th>Method</th>
                  <th className="led-num">In</th>
                  <th className="led-num">Your fee</th>
                  <th className="led-num">To the crew</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id} className={e.kind === "refund" ? "led-out" : ""}>
                    <td className="led-when">{day(e.at)}</td>
                    <td>
                      {/* A settlement has no customer (the contractor pays the office), so it names them once and says what it is. */}
                      {e.jobId ? (
                        <>
                          <Link href={`${base}/quotes/${e.jobId}`}>{e.customer}</Link>
                          <span className="led-sub">{e.staffName}</span>
                        </>
                      ) : (
                        <>
                          {e.staffName}
                          <span className="led-sub">paid you directly</span>
                        </>
                      )}
                    </td>
                    <td>
                      <span className={`led-tag led-tag-${e.kind}`}>{KIND_LABEL[e.kind]}</span>
                    </td>
                    <td>{METHOD_LABELS[e.method as PaymentMethod] ?? e.method}</td>
                    <td className="led-num">{e.amountCents === 0 ? "-" : usd(e.amountCents)}</td>
                    <td className="led-num led-fee">{e.feeCents === 0 ? "-" : usd(e.feeCents)}</td>
                    <td className="led-num">{usd(e.amountCents - e.feeCents)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4}>
                    {rows.length} {rows.length === 1 ? "entry" : "entries"}
                  </td>
                  <td className="led-num">{usd(totals.in)}</td>
                  <td className="led-num led-fee">{usd(totals.fee)}</td>
                  <td className="led-num">{usd(totals.crew)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Phone: the same rows, stacked. */}
          <ul className="led-cards">
            {rows.map((e) => (
              <li key={e.id} className={e.kind === "refund" ? "led-card led-out" : "led-card"}>
                <div className="led-card-top">
                  <span className={`led-tag led-tag-${e.kind}`}>{KIND_LABEL[e.kind]}</span>
                  <span className="led-card-amount">{usd(e.amountCents - e.feeCents)}</span>
                </div>
                <div className="led-card-who">
                  {e.jobId ? <Link href={`${base}/quotes/${e.jobId}`}>{e.customer}</Link> : `${e.staffName} paid you directly`}
                </div>
                <div className="led-card-meta">
                  {day(e.at)} · {METHOD_LABELS[e.method as PaymentMethod] ?? e.method} · {e.staffName}
                  {e.feeCents > 0 && <> · fee {usd(e.feeCents)}</>}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
