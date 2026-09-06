// The owner's view of every dollar in the business.
//
// Server-only, owner-only. Everything here is assembled from three tables and
// computed in one pass rather than queried per job: the arithmetic that decides
// what a contractor owes has to be the SAME arithmetic the crew's job page
// shows them, and the only way to guarantee that is for both to go through
// readLedger.
//
// The one idea worth holding on to: money moves in one direction. The customer
// pays the contractor, and the contractor pays the office its percentage out of
// that. The office never holds a customer's money and never owes a contractor
// anything, so every balance on this page is a number somebody owes the office
// and never the other way round.
import { readLedger, toCents, type Ledger } from "./fees";
import { pgUser } from "./rest";
import type { FeeSettlement, QuotePayment, Session, Staff } from "./types";

// How far back the "collected recently" figures look.
export const MONEY_WINDOW_DAYS = 30;

type JobRow = {
  id: string;
  name: string;
  assigned_to: string | null;
  quote_amount: number | string | null;
  fee_total_cents: number | null;
  status: string;
  created_at: string;
};

export type JobMoney = {
  id: string;
  name: string;
  staffId: string | null;
  staffName: string;
  status: string;
  ledger: Ledger;
};

export type ContractorMoney = {
  staffId: string | null;
  name: string;
  /** Jobs of theirs that have taken at least one payment. */
  jobs: number;
  /** Collected from customers on their jobs, all methods. */
  collectedCents: number;
  /** Of that, how much never went through Stripe. */
  offStripeCents: number;
  /** What the office has earned on their jobs so far. */
  feeEarnedCents: number;
  /** Taken automatically as a Stripe application fee. */
  feeCollectedCents: number;
  /** Sent over by hand afterwards - Zelle, Venmo, cash. */
  feeSettledCents: number;
  /** What they still owe the office. The only number that needs chasing. */
  balanceCents: number;
};

export type MoneyBoard = {
  /** Everything customers have handed over, on every open or finished job. */
  collectedCents: number;
  /** Still to collect from customers across jobs that aren't settled. */
  outstandingCents: number;
  feeEarnedCents: number;
  feeCollectedCents: number;
  feeSettledCents: number;
  /** Earned, less collected, less settled. What the office is still owed. */
  feeBalanceCents: number;
  /** Collected in the last MONEY_WINDOW_DAYS, split by how it arrived. */
  byMethod: { method: string; cents: number }[];
  recentCents: number;
  contractors: ContractorMoney[];
  /** Jobs with money still to come in, biggest balance first. */
  owing: JobMoney[];
  /** The last few payments, whoever recorded them. */
  recent: { payment: QuotePayment; job: string; customer: string }[];
  /** True when supabase/payments.sql hasn't been run yet. */
  missingTables: boolean;
};

async function readRows<T>(session: Session, path: string): Promise<{ rows: T[]; ok: boolean }> {
  const res = await pgUser(path, session.accessToken);
  // A 404 here means the migration hasn't been run. Told apart from "no rows"
  // on purpose: the page says which it is, because "$0.00 everywhere" and
  // "you haven't run the SQL file" look identical and only one is a problem.
  if (!res.ok) return { rows: [], ok: false };
  return { rows: (await res.json()) as T[], ok: true };
}

export async function moneyBoard(session: Session, staff: Staff[]): Promise<MoneyBoard> {
  const names = new Map(staff.map((s) => [s.id, s.full_name || s.email || "Unnamed"]));

  const [jobsRes, paymentsRes, settlementsRes] = await Promise.all([
    readRows<JobRow>(
      session,
      "quote_requests?customer_response=eq.accepted&status=neq.lost" +
        "&select=id,name,assigned_to,quote_amount,fee_total_cents,status,created_at" +
        "&order=created_at.desc&limit=1000",
    ),
    readRows<QuotePayment>(session, "quote_payments?select=*&order=created_at.desc&limit=2000"),
    readRows<FeeSettlement>(session, "fee_settlements?select=*&order=created_at.desc&limit=1000"),
  ]);

  const payments = paymentsRes.rows;
  const byJob = new Map<string, QuotePayment[]>();
  for (const p of payments) {
    const list = byJob.get(p.quote_id);
    if (list) list.push(p);
    else byJob.set(p.quote_id, [p]);
  }

  const jobs: JobMoney[] = jobsRes.rows.map((j) => ({
    id: j.id,
    name: j.name,
    staffId: j.assigned_to,
    staffName: j.assigned_to ? (names.get(j.assigned_to) ?? "Unassigned") : "Unassigned",
    status: j.status,
    // The same function the crew's page and the customer's page read through.
    // A second implementation here would drift, and the first anyone would know
    // of it is a contractor disputing a figure.
    ledger: readLedger(toCents(j.quote_amount), j.fee_total_cents, byJob.get(j.id) ?? []),
  }));

  // Fees the contractor has already sent over by hand.
  const settledByStaff = new Map<string, number>();
  for (const s of settlementsRes.rows) {
    settledByStaff.set(s.staff_id, (settledByStaff.get(s.staff_id) ?? 0) + s.amount_cents);
  }

  const perStaff = new Map<string, ContractorMoney>();
  const key = (id: string | null) => id ?? "unassigned";
  for (const job of jobs) {
    const k = key(job.staffId);
    let row = perStaff.get(k);
    if (!row) {
      row = {
        staffId: job.staffId,
        name: job.staffName,
        jobs: 0,
        collectedCents: 0,
        offStripeCents: 0,
        feeEarnedCents: 0,
        feeCollectedCents: 0,
        feeSettledCents: job.staffId ? (settledByStaff.get(job.staffId) ?? 0) : 0,
        balanceCents: 0,
      };
      perStaff.set(k, row);
    }
    if (job.ledger.paidCents > 0) row.jobs += 1;
    row.collectedCents += job.ledger.paidCents;
    row.offStripeCents += job.ledger.offStripeCents;
    // Earned means earned SO FAR: bounded by what the customer has actually
    // paid, which is what feeDueNowCents + feeCollectedCents adds up to. The
    // office is never owed money the contractor hasn't been handed yet.
    row.feeEarnedCents += job.ledger.feeDueNowCents + job.ledger.feeCollectedCents;
    row.feeCollectedCents += job.ledger.feeCollectedCents;
  }

  const contractors = [...perStaff.values()]
    .map((c) => ({
      ...c,
      balanceCents: Math.max(0, c.feeEarnedCents - c.feeCollectedCents - c.feeSettledCents),
    }))
    // Whoever owes the most, first. This page exists to answer one question.
    .sort((a, b) => b.balanceCents - a.balanceCents || b.collectedCents - a.collectedCents);

  const since = Date.now() - MONEY_WINDOW_DAYS * 86_400_000;
  const methodTotals = new Map<string, number>();
  let recentCents = 0;
  for (const p of payments) {
    if (p.status !== "paid" && p.status !== "refunded") continue;
    const when = new Date(p.paid_at ?? p.created_at).getTime();
    if (!Number.isFinite(when) || when < since) continue;
    const net = p.amount_cents - p.refunded_cents;
    recentCents += net;
    methodTotals.set(p.method, (methodTotals.get(p.method) ?? 0) + net);
  }

  const jobsById = new Map(jobs.map((j) => [j.id, j]));

  return {
    collectedCents: jobs.reduce((sum, j) => sum + j.ledger.paidCents, 0),
    outstandingCents: jobs.reduce((sum, j) => sum + j.ledger.dueCents, 0),
    feeEarnedCents: contractors.reduce((sum, c) => sum + c.feeEarnedCents, 0),
    feeCollectedCents: contractors.reduce((sum, c) => sum + c.feeCollectedCents, 0),
    feeSettledCents: contractors.reduce((sum, c) => sum + c.feeSettledCents, 0),
    feeBalanceCents: contractors.reduce((sum, c) => sum + c.balanceCents, 0),
    byMethod: [...methodTotals.entries()]
      .map(([method, cents]) => ({ method, cents }))
      .sort((a, b) => b.cents - a.cents),
    recentCents,
    contractors,
    owing: jobs.filter((j) => j.ledger.dueCents > 0).sort((a, b) => b.ledger.dueCents - a.ledger.dueCents),
    recent: payments
      .filter((p) => p.status === "paid" || p.status === "refunded")
      .slice(0, 25)
      .map((p) => ({
        payment: p,
        job: p.quote_id,
        customer: jobsById.get(p.quote_id)?.name ?? "A customer",
      })),
    missingTables: !paymentsRes.ok || !settlementsRes.ok,
  };
}
