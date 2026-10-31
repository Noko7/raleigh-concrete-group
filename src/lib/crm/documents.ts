// What the Documents hub shows: every agreement and receipt, grouped by job. Pure, so the grouping and the
// one-line summary a job page shows are tested (documents.test.ts) without a database.
import type { Agreement, AgreementStatus, Quote, Session } from "./types";

export type DocAgreement = {
  id: string;
  kind: "contractor" | "customer";
  quote_id: string | null;
  status: AgreementStatus;
  created_at: string;
  updated_at: string;
};

export type DocReceipt = {
  id: string;
  quote_id: string;
  amount_cents: number;
  issued_at: string;
  voided_at: string | null;
  is_test: boolean;
};

export type JobDocs = {
  quoteId: string;
  /** The agreement that speaks for the job: signed beats sent beats pending; declined and void only if nothing else. */
  agreement: AgreementStatus | null;
  agreements: number;
  /** Live receipts only: a voided one was replaced or the payment undone. */
  receipts: number;
  receivedCents: number;
  lastActivity: string;
};

const RANK: Record<AgreementStatus, number> = { signed: 5, sent: 4, pending: 3, declined: 2, void: 1 };

export function agreementHeadline(statuses: AgreementStatus[]): AgreementStatus | null {
  let best: AgreementStatus | null = null;
  for (const s of statuses) if (!best || RANK[s] > RANK[best]) best = s;
  return best;
}

/** One entry per job with any document, newest activity first. Contractor onboarding agreements are not jobs. */
export function groupByJob(agreements: DocAgreement[], receipts: DocReceipt[]): JobDocs[] {
  const jobs = new Map<string, { statuses: AgreementStatus[]; receipts: number; cents: number; last: string }>();
  const at = (id: string) => {
    let j = jobs.get(id);
    if (!j) jobs.set(id, (j = { statuses: [], receipts: 0, cents: 0, last: "" }));
    return j;
  };
  for (const a of agreements) {
    if (a.kind !== "customer" || !a.quote_id) continue;
    const j = at(a.quote_id);
    j.statuses.push(a.status);
    if (a.updated_at > j.last) j.last = a.updated_at;
  }
  for (const r of receipts) {
    const j = at(r.quote_id);
    if (!r.voided_at) {
      j.receipts += 1;
      j.cents += r.amount_cents;
    }
    const when = r.voided_at && r.voided_at > r.issued_at ? r.voided_at : r.issued_at;
    if (when > j.last) j.last = when;
  }
  return [...jobs.entries()]
    .map(([quoteId, j]) => ({
      quoteId,
      agreement: agreementHeadline(j.statuses),
      agreements: j.statuses.length,
      receipts: j.receipts,
      receivedCents: j.cents,
      lastActivity: j.last,
    }))
    .sort((a, b) => (a.lastActivity < b.lastActivity ? 1 : a.lastActivity > b.lastActivity ? -1 : 0));
}

const AGREEMENT_WORDS: Record<AgreementStatus, string> = {
  pending: "agreement not sent",
  sent: "agreement awaiting signature",
  signed: "agreement signed",
  declined: "agreement declined",
  void: "agreement void",
};

/** The single line a job page shows in place of its old document sections, e.g. "Agreement signed · 2 receipts". */
export function docsLine(d: Pick<JobDocs, "agreement" | "receipts"> | null): string {
  const parts: string[] = [];
  if (d?.agreement) parts.push(AGREEMENT_WORDS[d.agreement]);
  if (d && d.receipts > 0) parts.push(`${d.receipts} ${d.receipts === 1 ? "receipt" : "receipts"}`);
  if (parts.length === 0) return "No documents yet";
  const line = parts.join(" · ");
  return line.charAt(0).toUpperCase() + line.slice(1);
}

// ── Agreements written in the CRM ──────────────────────────────────────────

/** Who may write a job's agreement: the owner, or the contractor assigned to it. */
export function canEditJobAgreement(session: Session, quote: Pick<Quote, "assigned_to">): boolean {
  return session.staff.role === "owner" || (quote.assigned_to != null && quote.assigned_to === session.staff.id);
}

/** The agreement the editor works on: the newest one on the job that was written in the CRM. */
export function editableAgreement(agreements: Agreement[]): Agreement | null {
  return (
    [...agreements]
      .filter((a) => a.kind === "customer" && a.current_version_id)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0] ?? null
  );
}

