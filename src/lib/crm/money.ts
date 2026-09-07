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
import { readLedger, toCents, usd, type Ledger } from "./fees";
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
  // The frozen rate. Read alongside the cents figure so the ledger can be
  // re-derived from it rather than trusting a stamp that predates the last
  // time somebody edited the price.
  fee_rate: number | null;
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
  ledger: Ledger;
  /** Every payment on this job, newest first, for the row that expands. */
  payments: QuotePayment[];
  /**
   * Whether this job is still part of the pipeline.
   *
   * False for one that took money and then went to Lost, was archived, or had
   * its quote retracted. Money it collected is still money: it counts in
   * takings and in what the office earned, because the customer really did
   * hand it over. What it does NOT do is count in "customers still owe" -
   * nobody is chasing the balance of a job that is over.
   */
  onBooks: boolean;
  /** A practice lead. Real rows, real arithmetic, kept out of the real totals. */
  isTest: boolean;
};

// ── The ledger itself ───────────────────────────────────────────────────────
// One row per movement of money, whatever kind. Payments and refunds come from
// the customer's side; a settlement is the contractor handing the office the
// cut a cash job never took on its way past. They belong in one list because
// they answer one question - what has actually moved - and keeping them in two
// is how a month's takings and a month's fees end up reconciled by hand.
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
  /** Money in, in cents. Negative on a refund, which is money going back out. */
  amountCents: number;
  /** The office's cut carried by this row. */
  feeCents: number;
  note: string | null;
};

// ── Rows the numbers cannot be trusted on ───────────────────────────────────
// Every figure on this page is a sum over rows, so one wrong row is a wrong
// total with nothing on screen to say so. These are the shapes that produce a
// number the page cannot justify, listed by name so they can be opened and
// fixed rather than guessed at.
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
  /** What it is doing to the totals, in cents. Zero when it only distorts a count. */
  effectCents: number;
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
  /** Every accepted job, newest first, each with its own payments attached. */
  jobs: JobMoney[];
  /** Every movement of money, newest first. */
  entries: LedgerEntry[];
  /** Rows whose shape makes a total above wrong. Empty is the healthy state. */
  attention: AttentionRow[];
  /** True when supabase/payments.sql hasn't been run yet. */
  missingTables: boolean;
  /** How many practice leads were left out. Zero hides the switch entirely. */
  testCount: number;
  /** Whether this board was built with them in. */
  includingTests: boolean;
};

async function readRows<T>(session: Session, path: string): Promise<{ rows: T[]; ok: boolean }> {
  const res = await pgUser(path, session.accessToken);
  // A 404 here means the migration hasn't been run. Told apart from "no rows"
  // on purpose: the page says which it is, because "$0.00 everywhere" and
  // "you haven't run the SQL file" look identical and only one is a problem.
  if (!res.ok) return { rows: [], ok: false };
  return { rows: (await res.json()) as T[], ok: true };
}

export async function moneyBoard(
  session: Session,
  staff: Staff[],
  // Testing a payment writes a real row through the real code, which is the
  // only kind of test worth running - and the reason a morning of trying
  // things out otherwise shows up as takings. Practice leads are left out of
  // every figure here by default and put back in when somebody is checking
  // that a test payment landed the way they expected.
  opts: { includeTests?: boolean } = {},
): Promise<MoneyBoard> {
  const includeTests = opts.includeTests === true;
  const names = new Map(staff.map((s) => [s.id, s.full_name || s.email || "Unnamed"]));
  // Practice accounts. A test contractor's settlement is a real row in
  // fee_settlements, and it was counting as a fee received while the practice
  // job that earned it was hidden - so the office looked to have been paid a
  // cut it never earned. Their jobs are NOT swept up with them: a real
  // customer's job assigned to a test account is still a real job.
  const testStaff = new Set(staff.filter((p) => p.is_test).map((p) => p.id));

  const [jobsRes, paymentsRes, settlementsRes] = await Promise.all([
    readRows<JobRow>(
      session,
      "quote_requests?customer_response=eq.accepted&status=neq.lost" +
        "&select=id,name,assigned_to,quote_amount,fee_total_cents,fee_rate,status,paid_at,completed_at,created_at,is_test" +
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

  // Jobs with money on them that the filter above would have dropped: marked
  // lost, archived, or no longer showing as accepted. Left out, their payments
  // sat in quote_payments and in no total on this page - money that had
  // genuinely been collected, invisible because somebody changed a status
  // afterwards. A ledger that loses track of money when a row changes state is
  // not a ledger, so they are fetched back in and marked.
  const known = new Set(jobsRes.rows.map((j) => j.id));
  const strays = [...new Set(payments.map((p) => p.quote_id))].filter((id) => id && !known.has(id));
  if (strays.length > 0) {
    const extra = await readRows<JobRow>(
      session,
      `quote_requests?id=in.(${strays.slice(0, 200).join(",")})` +
        "&select=id,name,assigned_to,quote_amount,fee_total_cents,fee_rate,status,paid_at,completed_at,created_at,is_test",
    );
    jobsRes.rows.push(...extra.rows);
  }

  const allJobs: JobMoney[] = jobsRes.rows.map((j) => ({
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
    // The same function the crew's page and the customer's page read through.
    // A second implementation here would drift, and the first anyone would know
    // of it is a contractor disputing a figure. The rate goes in with it, so
    // the fee is a percentage of what the job is worth now rather than of
    // whatever it was worth the day the rate was frozen.
    ledger: readLedger(toCents(j.quote_amount), j.fee_total_cents, byJob.get(j.id) ?? [], j.fee_rate),
  }));

  // One gate, applied everywhere a figure is summed. Anything that reads a
  // payment has to ask this too, or the tiles and the ledger under them
  // disagree about which morning actually happened.
  const testIds = new Set(allJobs.filter((j) => j.isTest).map((j) => j.id));
  const counts = (quoteId: string | null) => includeTests || !quoteId || !testIds.has(quoteId);
  const jobs = includeTests ? allJobs : allJobs.filter((j) => !j.isTest);

  // Fees the contractor has already sent over by hand.
  //
  // Gated like everything else that reads money. A settlement recorded against
  // a practice job is practice: without this the tile would report a fee
  // received against a job whose fee was never earned, and "your fees,
  // received" would disagree with the ledger it sits above. A settlement with
  // no job on it cannot be told apart from a real one, so it stays - that is
  // the honest reading of a payment somebody made against a balance rather
  // than against a job.
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
    .filter((c) => includeTests || !c.staffId || !testStaff.has(c.staffId))
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
    if (!counts(p.quote_id)) continue;
    const when = new Date(p.paid_at ?? p.created_at).getTime();
    if (!Number.isFinite(when) || when < since) continue;
    const net = p.amount_cents - p.refunded_cents;
    recentCents += net;
    methodTotals.set(p.method, (methodTotals.get(p.method) ?? 0) + net);
  }

  const jobsById = new Map(jobs.map((j) => [j.id, j]));

  // ── One list of everything that moved ───────────────────────────────────
  // A refund is its own row rather than a smaller payment: the money went out
  // on a different day, and a ledger that quietly rewrites the original entry
  // cannot be reconciled against a bank statement.
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
      // Money reaching the office, not the crew. It is the fee arriving late,
      // so it counts in the fee column and not in takings - putting it in both
      // would count one dollar twice.
      amountCents: 0,
      feeCents: st.amount_cents,
      note: st.note,
    });
  }
  entries.sort((a, b) => b.at.localeCompare(a.at));

  // ── Rows that make a total lie ──────────────────────────────────────────
  const attention: AttentionRow[] = [];
  for (const j of jobs) {
    // Off-books jobs have their own row further down. Running them through the
    // rules below would flag a lost job for being unpaid, which is the point
    // of it being lost.
    if (!j.onBooks) continue;
    const total = j.ledger.totalCents;

    // The big one, and the reason a healthy business reads as owing money it
    // does not. Jobs closed out before the payments ledger existed carry a
    // paid_at and a status of Paid, and no payment rows at all - so every
    // penny of them counts as still outstanding, forever.
    if ((j.status === "paid" || j.paidAt) && j.payments.length === 0 && total > 0) {
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
    // Accepted with no price: contributes nothing and cannot be chased,
    // because there is no figure to chase.
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
    // More collected than the job is worth. Usually a payment recorded twice.
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
    // Money came in and the office's rate was never frozen, so every fee
    // figure on this job reads zero.
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
  // Money on a job that left the pipeline. It is in the totals now rather than
  // nowhere, but it is still worth a person's eye: either the customer is owed
  // a refund, or the job was not really lost, or - most often - it is a test
  // row somebody left behind.
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
    // Only what somebody is actually going to be asked for. A job that took a
    // deposit and then went to Lost is not a customer who owes the balance.
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
    testCount: allJobs.filter((j) => j.isTest).length,
    includingTests: includeTests,
  };
}
