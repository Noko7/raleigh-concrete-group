// The owner's view of every dollar (a contractor gets the same board scoped to their jobs). Server-only.
// All figures go through readLedger so they match the crew's job page exactly.
// Money flows one way: customer pays contractor, contractor pays the office its cut. Every balance here
// is owed TO the office.
import { applySettlements, readLedger, toCents, usd, type Ledger } from "./fees";
import { pgAdmin, pgUser } from "./rest";
import type { FeeSettlement, QuotePayment, Session, Staff } from "./types";

export const MONEY_WINDOW_DAYS = 30;

// Row ceilings. Every figure is a sum over rows, so a capped read is a silently low total;
// the page reports which read hit its ceiling.
const JOB_LIMIT = 1000;
const PAYMENT_LIMIT = 2000;
const SETTLEMENT_LIMIT = 1000;

type JobRow = {
  id: string;
  name: string;
  assigned_to: string | null;
  quote_amount: number | string | null;
  fee_total_cents: number | null;
  // Frozen rate, read with the cents figure so the ledger can be re-derived after price edits.
  fee_rate: number | null;
  fee_waived_cents: number | null;
  status: string;
  paid_at: string | null;
  completed_at: string | null;
  created_at: string;
  is_test: boolean | null;
};

export type JobMoney = {
  id: string;
  name: string;
  staffId: string | null;
  staffName: string;
  status: string;
  paidAt: string | null;
  createdAt: string;
  /** Net of fee already settled against THIS job, so feeDueNowCents is what is still owed on it. */
  ledger: Ledger;
  /** Office fee: its rate on the whole job total. */
  feeEarnedCents: number;
  /** Stripe application fee plus fee settled by hand. */
  feeReceivedCents: number;
  payments: QuotePayment[];
  /**
   * False once the job went Lost, was archived, or had its quote retracted. Its money still counts in
   * takings and fees earned, but not in "customers still owe".
   */
  onBooks: boolean;
  /** Practice lead: real rows, excluded from real totals. */
  isTest: boolean;
};

// One row per movement of money, so takings and fees reconcile from a single list.
export type LedgerEntryKind = "payment" | "refund" | "settlement";

export type LedgerEntry = {
  id: string;
  kind: LedgerEntryKind;
  at: string;
  /** Null on a settlement, which is paid against a balance rather than a job. */
  jobId: string | null;
  customer: string;
  staffId: string | null;
  staffName: string;
  method: string;
  /** Cents. Negative on a refund. */
  amountCents: number;
  /** Office cut carried by this row, in cents. */
  feeCents: number;
  note: string | null;
};

// Rows whose shape makes a total wrong, listed so they can be fixed.
export type AttentionKind =
  | "paid_no_payments"
  | "accepted_no_price"
  | "overpaid"
  | "fee_unrated"
  | "orphan_payment";

export type AttentionRow = {
  kind: AttentionKind;
  jobId: string | null;
  name: string;
  staffName: string;
  detail: string;
  /** Effect on the totals, in cents. Zero when it only distorts a count. */
  effectCents: number;
};

export type ContractorMoney = {
  staffId: string | null;
  name: string;
  /** Only jobs that have taken at least one payment. */
  jobs: number;
  /** After change orders. */
  jobValueCents: number;
  collectedCents: number;
  offStripeCents: number;
  feeEarnedCents: number;
  /** Taken automatically as a Stripe application fee. */
  feeCollectedCents: number;
  /** Sent over by hand afterwards (Zelle, Venmo, cash). */
  feeSettledCents: number;
  /** What they still owe the office. */
  balanceCents: number;
};

export type MoneyBoard = {
  /** From customers, on every open or finished job. */
  collectedCents: number;
  outstandingCents: number;
  feeEarnedCents: number;
  feeCollectedCents: number;
  feeSettledCents: number;
  /** Earned - collected - settled. */
  feeBalanceCents: number;
  byMethod: { method: string; cents: number }[];
  recentCents: number;
  contractors: ContractorMoney[];
  /** Biggest balance first. */
  owing: JobMoney[];
  jobs: JobMoney[];
  entries: LedgerEntry[];
  /** Empty is the healthy state. */
  attention: AttentionRow[];
  /** Payment tables missing (read returned 404). */
  missingTables: boolean;
  /** Reads that hit their row ceiling. Non-empty means the totals cover only a slice. */
  truncated: string[];
  /**
   * All-time count and dollar total of sent quotes, read separately so row ceilings can't shrink it.
   * Null means the read failed; the card shows a dash, not a misleading $0.
   */
  quotesSentAllTime: { count: number; cents: number } | null;
  /** Zero hides the switch. */
  testCount: number;
  includingTests: boolean;
};

async function readRows<T>(session: Session, path: string): Promise<{ rows: T[]; ok: boolean }> {
  const res = await pgUser(path, session.accessToken);
  // 404 = table missing, reported separately from "no rows".
  if (!res.ok) return { rows: [], ok: false };
  return { rows: (await res.json()) as T[], ok: true };
}

/** Paged until a short page: the figure says "all time". PostgREST aggregates are off by default on Supabase. */
const SENT_PAGE = 1000;
const SENT_MAX_PAGES = 200;
async function sumQuotes(session: Session, path: string): Promise<{ count: number; cents: number } | null> {
  let count = 0;
  let cents = 0;
  for (let page = 0; page < SENT_MAX_PAGES; page++) {
    const res = await pgUser(
      `${path}&select=quote_amount&order=id.asc&limit=${SENT_PAGE}&offset=${page * SENT_PAGE}`,
      session.accessToken,
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as { quote_amount: number | string | null }[];
    count += rows.length;
    for (const r of rows) cents += toCents(r.quote_amount);
    if (rows.length < SENT_PAGE) return { count, cents };
  }
  // 200,000 quotes. Past this a short total is worse than none.
  return null;
}

export async function moneyBoard(
  session: Session,
  staff: Staff[],
  // Test payments write real rows, so practice leads are excluded unless includeTests.
  opts: { includeTests?: boolean } = {},
): Promise<MoneyBoard> {
  const includeTests = opts.includeTests === true;
  // Contractors read this board too. RLS scopes their jobs and payments, but settlements are owner-only
  // (contractors must not write them), so theirs are read with the service key pinned to their staff id.
  // Otherwise a crew that sent the fee would still be shown as owing it.
  const isOwner = session.staff.role === "owner";
  const settlementsPath = `fee_settlements?select=*&order=created_at.desc&limit=${SETTLEMENT_LIMIT}`;
  const readSettlements = isOwner
    ? readRows<FeeSettlement>(session, settlementsPath)
    : pgAdmin(`${settlementsPath}&staff_id=eq.${session.staff.id}`).then(async (res) => ({
        rows: res.ok ? ((await res.json()) as FeeSettlement[]) : [],
        ok: res.ok,
      }));
  const names = new Map(staff.map((s) => [s.id, s.full_name || s.email || "Unnamed"]));
  // A test contractor's settlements are excluded (their job is hidden, so the fee was never earned).
  // Their jobs are not: a real customer's job assigned to a test account is still real.
  const testStaff = new Set(staff.filter((p) => p.is_test).map((p) => p.id));

  // Retracted quotes drop out (wipeQuote clears quote_sent_at). Counts customers, not sends: re-sends
  // reuse the same row.
  const [jobsRes, paymentsRes, settlementsRes, quotesSentAllTime] = await Promise.all([
    readRows<JobRow>(
      session,
      "quote_requests?customer_response=eq.accepted&status=neq.lost" +
        "&select=id,name,assigned_to,quote_amount,fee_total_cents,fee_rate,fee_waived_cents,status,paid_at,completed_at,created_at,is_test" +
        `&order=created_at.desc&limit=${JOB_LIMIT}`,
    ),
    readRows<QuotePayment>(session, `quote_payments?select=*&order=created_at.desc&limit=${PAYMENT_LIMIT}`),
    readSettlements,
    // `not.is.true`, not `is.false`: is_test is null on older rows.
    isOwner
      ? sumQuotes(session, `quote_requests?quote_sent_at=not.is.null${includeTests ? "" : "&is_test=not.is.true"}`)
      : Promise.resolve(null),
  ]);

  // A read that came back exactly full was probably cut short. Measured before the stray-job top-up adds rows.
  const truncated = [
    jobsRes.rows.length >= JOB_LIMIT ? "jobs" : null,
    paymentsRes.rows.length >= PAYMENT_LIMIT ? "payments" : null,
    settlementsRes.rows.length >= SETTLEMENT_LIMIT ? "settlements" : null,
  ].filter((v): v is string => v !== null);

  const payments = paymentsRes.rows;
  const byJob = new Map<string, QuotePayment[]>();
  for (const p of payments) {
    const list = byJob.get(p.quote_id);
    if (list) list.push(p);
    else byJob.set(p.quote_id, [p]);
  }

  // Jobs with money that the filter above dropped (lost, archived, no longer accepted). Fetched back so
  // their payments still appear in the totals.
  const known = new Set(jobsRes.rows.map((j) => j.id));
  const strays = [...new Set(payments.map((p) => p.quote_id))].filter((id) => id && !known.has(id));
  if (strays.length > 0) {
    const extra = await readRows<JobRow>(
      session,
      `quote_requests?id=in.(${strays.slice(0, 200).join(",")})` +
        "&select=id,name,assigned_to,quote_amount,fee_total_cents,fee_rate,fee_waived_cents,status,paid_at,completed_at,created_at,is_test",
    );
    jobsRes.rows.push(...extra.rows);
  }

  // A settlement with no job still counts against the contractor's balance; it just has no job row.
  const settledByJob = new Map<string, number>();
  for (const s of settlementsRes.rows) {
    if (!s.quote_id) continue;
    settledByJob.set(s.quote_id, (settledByJob.get(s.quote_id) ?? 0) + s.amount_cents);
  }

  const allJobs: JobMoney[] = jobsRes.rows.map((j) => {
    const raw = readLedger(toCents(j.quote_amount), j.fee_total_cents, byJob.get(j.id) ?? [], j.fee_rate, j.fee_waived_cents);
    const ledger = applySettlements(raw, settledByJob.get(j.id) ?? 0);
    return {
      id: j.id,
      name: j.name,
      staffId: j.assigned_to,
      staffName: j.assigned_to ? (names.get(j.assigned_to) ?? "Unassigned") : "Unassigned",
      status: j.status,
      paidAt: j.paid_at,
      createdAt: j.created_at,
      payments: byJob.get(j.id) ?? [],
      onBooks: known.has(j.id),
      isTest: j.is_test === true,
      // Same function the crew and customer pages use, so figures can't drift. Current rate, so the fee tracks
      // what the job is worth now.
      ledger,
      feeEarnedCents: raw.feeEarnedCents,
      feeReceivedCents: raw.feeCollectedCents + ledger.feeSettledCents,
    };
  });

  // Every money sum must apply this gate, or tiles and ledger disagree.
  const testIds = new Set(allJobs.filter((j) => j.isTest).map((j) => j.id));
  const counts = (quoteId: string | null) => includeTests || !quoteId || !testIds.has(quoteId);
  const jobs = includeTests ? allJobs : allJobs.filter((j) => !j.isTest);

  // Settlements on practice jobs are excluded. A settlement with no job can't be told apart, so it stays.
  const settledByStaff = new Map<string, number>();
  for (const s of settlementsRes.rows) {
    if (!counts(s.quote_id)) continue;
    if (!includeTests && testStaff.has(s.staff_id)) continue;
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
        jobValueCents: 0,
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
    if (job.onBooks) row.jobValueCents += job.ledger.totalCents;
    row.collectedCents += job.ledger.paidCents;
    row.offStripeCents += job.ledger.offStripeCents;
    // Whichever is larger of earned and Stripe-collected is what the office has had.
    row.feeEarnedCents += Math.max(job.feeEarnedCents, job.ledger.feeCollectedCents);
    row.feeCollectedCents += job.ledger.feeCollectedCents;
  }

  const contractors = [...perStaff.values()]
    .filter((c) => includeTests || !c.staffId || !testStaff.has(c.staffId))
    .map((c) => ({
      ...c,
      balanceCents: Math.max(0, c.feeEarnedCents - c.feeCollectedCents - c.feeSettledCents),
    }))
    .sort((a, b) => b.balanceCents - a.balanceCents || b.collectedCents - a.collectedCents);

  const since = Date.now() - MONEY_WINDOW_DAYS * 86_400_000;
  const methodTotals = new Map<string, number>();
  let recentCents = 0;
  for (const p of payments) {
    if (p.status !== "paid" && p.status !== "refunded") continue;
    if (!counts(p.quote_id)) continue;
    const when = new Date(p.paid_at ?? p.created_at).getTime();
    if (!Number.isFinite(when) || when < since) continue;
    const net = p.amount_cents - p.refunded_cents;
    recentCents += net;
    methodTotals.set(p.method, (methodTotals.get(p.method) ?? 0) + net);
  }

  const jobsById = new Map(jobs.map((j) => [j.id, j]));

  // A refund is its own row (different day), so the ledger reconciles against a bank statement.
  const entries: LedgerEntry[] = [];
  for (const p of payments) {
    if (p.status !== "paid" && p.status !== "refunded") continue;
    if (!counts(p.quote_id)) continue;
    const job = jobsById.get(p.quote_id);
    const common = {
      jobId: p.quote_id,
      customer: job?.name ?? "A customer",
      staffId: job?.staffId ?? null,
      staffName: job?.staffName ?? "Unassigned",
      method: p.method,
      note: p.note,
    };
    entries.push({
      ...common,
      id: p.id,
      kind: "payment",
      at: p.paid_at ?? p.created_at,
      amountCents: p.amount_cents,
      feeCents: p.fee_cents,
    });
    if (p.refunded_cents > 0) {
      entries.push({
        ...common,
        id: `${p.id}:refund`,
        kind: "refund",
        at: p.refunded_at ?? p.paid_at ?? p.created_at,
        amountCents: -p.refunded_cents,
        feeCents: 0,
      });
    }
  }
  for (const st of settlementsRes.rows) {
    if (!counts(st.quote_id)) continue;
    entries.push({
      id: st.id,
      kind: "settlement",
      at: st.created_at,
      jobId: st.quote_id,
      customer: st.quote_id ? (jobsById.get(st.quote_id)?.name ?? "A customer") : "-",
      staffId: st.staff_id,
      staffName: names.get(st.staff_id) ?? "A contractor",
      method: st.method,
      // Fee reaching the office: fee column only, not takings, or it counts twice.
      amountCents: 0,
      feeCents: st.amount_cents,
      note: st.note,
    });
  }
  entries.sort((a, b) => b.at.localeCompare(a.at));

  const attention: AttentionRow[] = [];
  for (const j of jobs) {
    // Off-books jobs get their own row below; the rules here would flag a lost job as unpaid.
    if (!j.onBooks) continue;
    const total = j.ledger.totalCents;

    // Jobs closed before the payments ledger existed: Paid status, no payment rows, so they read as outstanding
    // forever. Only counted rows matter: a job whose only payment was voided must still be flagged.
    const countedRows = j.payments.filter((p) => p.status === "paid" || p.status === "refunded");
    if ((j.status === "paid" || j.paidAt) && countedRows.length === 0 && total > 0) {
      attention.push({
        kind: "paid_no_payments",
        jobId: j.id,
        name: j.name,
        staffName: j.staffName,
        detail: "Marked paid, but no payment was ever recorded against it.",
        effectCents: total,
      });
      continue;
    }
    // Accepted with no price: nothing to chase.
    if (total <= 0) {
      attention.push({
        kind: "accepted_no_price",
        jobId: j.id,
        name: j.name,
        staffName: j.staffName,
        detail: "Approved by the customer with no price on the job.",
        effectCents: j.ledger.paidCents,
      });
      continue;
    }
    // Usually a payment recorded twice.
    if (j.ledger.paidCents > total) {
      attention.push({
        kind: "overpaid",
        jobId: j.id,
        name: j.name,
        staffName: j.staffName,
        detail: `Collected ${usd(j.ledger.paidCents)} against a ${usd(total)} job.`,
        effectCents: j.ledger.paidCents - total,
      });
      continue;
    }
    // Money came in but the rate was never frozen, so every fee figure reads zero.
    if (j.ledger.paidCents > 0 && j.ledger.feeTotalCents === 0) {
      attention.push({
        kind: "fee_unrated",
        jobId: j.id,
        name: j.name,
        staffName: j.staffName,
        detail: "Has taken money but carries no fee rate, so it earns the office nothing.",
        effectCents: 0,
      });
    }
  }
  // Money on a job that left the pipeline: refund owed, not really lost, or a leftover test row.
  for (const j of jobs) {
    if (j.onBooks || j.ledger.paidCents === 0) continue;
    attention.push({
      kind: "orphan_payment",
      jobId: j.id,
      name: j.name,
      staffName: j.staffName,
      detail: `Took ${usd(j.ledger.paidCents)} and is now ${j.status}. Counted in takings, not in what customers owe.`,
      effectCents: j.ledger.paidCents,
    });
  }
  attention.sort((a, b) => b.effectCents - a.effectCents);

  return {
    collectedCents: jobs.reduce((sum, j) => sum + j.ledger.paidCents, 0),
    // Lost jobs that took a deposit don't owe the balance.
    outstandingCents: jobs.reduce((sum, j) => sum + (j.onBooks ? j.ledger.dueCents : 0), 0),
    feeEarnedCents: contractors.reduce((sum, c) => sum + c.feeEarnedCents, 0),
    feeCollectedCents: contractors.reduce((sum, c) => sum + c.feeCollectedCents, 0),
    feeSettledCents: contractors.reduce((sum, c) => sum + c.feeSettledCents, 0),
    feeBalanceCents: contractors.reduce((sum, c) => sum + c.balanceCents, 0),
    byMethod: [...methodTotals.entries()]
      .map(([method, cents]) => ({ method, cents }))
      .sort((a, b) => b.cents - a.cents),
    recentCents,
    contractors,
    owing: jobs
      .filter((j) => j.onBooks && j.ledger.dueCents > 0)
      .sort((a, b) => b.ledger.dueCents - a.ledger.dueCents),
    jobs,
    entries,
    attention,
    missingTables: !paymentsRes.ok || !settlementsRes.ok,
    truncated,
    quotesSentAllTime,
    testCount: allJobs.filter((j) => j.isTest).length,
    includingTests: includeTests,
  };
}
