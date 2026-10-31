// DocuSeal, the parts that need no network: checking a webhook really came from DocuSeal, building the request
// that sends an agreement version for signing, reading the response and webhooks, and deciding what each webhook
// does to an agreement's status. Tested in docuseal-core.test.ts.
//
// Signing order: the Contractor signs first (order 0), then the Customer (order 1). The request passes
// order "preserved" with DocuSeal's emails on, so DocuSeal emails only the contractor at first and emails the
// customer automatically once the contractor has signed. DocuSeal does not stop a customer opening their link
// early on a one-off HTML submission, so the customer's page on this site also only shows the signing form once
// the agreement is contractor_signed (see /sign/[token]).
import { createHmac, timingSafeEqual } from "node:crypto";

export type SignerRole = "Contractor" | "Customer";

export type Signer = {
  role: SignerRole;
  submitter_id: number;
  slug: string;
  embed_src: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  completed_at: string | null;
  declined_at: string | null;
};

export type AgreementSigningStatus = "pending" | "sent" | "contractor_signed" | "signed" | "declined" | "expired" | "void";

/** Statuses during which the document is frozen (no new version can be saved; the database enforces it too). */
export const FROZEN: AgreementSigningStatus[] = ["sent", "contractor_signed", "signed", "void"];
/** Statuses from which it can be sent (again). */
export const SENDABLE: AgreementSigningStatus[] = ["pending", "declined", "expired"];

// ── Webhook signature ───────────────────────────────────────────────────────

/**
 * DocuSeal signs each webhook as `X-Docuseal-Signature: <unix ts>.<hex HMAC-SHA256(secret, "<ts>.<raw body>")>`,
 * with the whole secret string (whsec_...) as the key, and accepts 5 minutes of clock difference either way.
 * Mirrors WebhookUrls::Signatures.verify in DocuSeal's source.
 */
export function verifyDocusealSignature(input: {
  secret: string;
  rawBody: string;
  header: string | null;
  nowSeconds: number;
  toleranceSeconds?: number;
}): { ok: true } | { ok: false; reason: string } {
  const tolerance = input.toleranceSeconds ?? 300;
  if (!input.secret) return { ok: false, reason: "no secret configured" };
  const [tsRaw, sig] = splitOnce(input.header ?? "");
  const ts = /^\d{1,12}$/.test(tsRaw) ? Number(tsRaw) : NaN;
  if (!Number.isFinite(ts) || !/^[0-9a-f]{64}$/.test(sig)) return { ok: false, reason: "malformed signature" };
  if (ts < input.nowSeconds - tolerance) return { ok: false, reason: "too old" };
  if (ts > input.nowSeconds + tolerance) return { ok: false, reason: "in the future" };
  const expected = createHmac("sha256", input.secret).update(`${ts}.${input.rawBody}`).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(sig, "utf8");
  return a.length === b.length && timingSafeEqual(a, b) ? { ok: true } : { ok: false, reason: "bad signature" };
}

function splitOnce(s: string): [string, string] {
  const i = s.indexOf(".");
  return i < 0 ? [s, ""] : [s.slice(0, i), s.slice(i + 1)];
}

/** For tests and local tools: what DocuSeal would send. */
export function signDocuseal(secret: string, rawBody: string, ts: number): string {
  return `${ts}.${createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex")}`;
}

// ── Sending ─────────────────────────────────────────────────────────────────

export type SendInput = {
  agreementId: string;
  version: { id: string; version_no: number; html: string; html_sha256: string };
  title: string;
  contractor: { name: string; email: string | null; phone: string | null };
  customer: { name: string; email: string | null; phone: string | null };
  expireAt: string;
};

const e164 = (p: string | null) => (p && /^\+\d{10,15}$/.test(p) ? p : undefined);
const email = (e: string | null) => (e && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.trim()) ? e.trim() : undefined);

/**
 * The POST /submissions/html body. The stored HTML of the version is sent as is (never re-rendered), so the
 * signed PDF is exactly the saved version; its fingerprint rides along in each signer's metadata. DocuSeal emails
 * the signers in order (the customer only after the contractor signs); the site also texts the links.
 */
export function buildSubmissionRequest(s: SendInput): Record<string, unknown> {
  const meta = { agreement_id: s.agreementId, version_id: s.version.id, version_no: s.version.version_no, html_sha256: s.version.html_sha256 };
  return {
    name: s.title.slice(0, 200),
    send_email: true,
    order: "preserved",
    expire_at: s.expireAt,
    documents: [{ name: `${s.title} (v${s.version.version_no})`.slice(0, 200), html: s.version.html, size: "Letter" }],
    submitters: [
      { role: "Contractor", order: 0, name: s.contractor.name, email: email(s.contractor.email), phone: e164(s.contractor.phone), external_id: `${s.agreementId}:contractor`, metadata: meta },
      { role: "Customer", order: 1, name: s.customer.name, email: email(s.customer.email), phone: e164(s.customer.phone), external_id: `${s.agreementId}:customer`, metadata: meta },
    ],
  };
}

type RawSubmitter = {
  id?: unknown; role?: unknown; slug?: unknown; embed_src?: unknown; name?: unknown; email?: unknown; phone?: unknown;
  completed_at?: unknown; declined_at?: unknown; submission_id?: unknown;
};
const str = (x: unknown) => (typeof x === "string" && x ? x : null);

/** The signers from a /submissions/html response (an array of submitters, or an object with `submitters`). */
export function readSigners(resp: unknown): { submissionId: number; signers: Signer[] } | null {
  const list: RawSubmitter[] = Array.isArray(resp) ? resp : Array.isArray((resp as { submitters?: unknown })?.submitters) ? (resp as { submitters: RawSubmitter[] }).submitters : [];
  const subId = Array.isArray(resp) ? Number(list[0]?.submission_id) : Number((resp as { id?: unknown })?.id);
  const signers: Signer[] = [];
  for (const r of list) {
    const role = r.role === "Contractor" || r.role === "Customer" ? r.role : null;
    if (!role || typeof r.id !== "number" || !str(r.slug) || !str(r.embed_src)) return null;
    signers.push({ role, submitter_id: r.id, slug: str(r.slug)!, embed_src: str(r.embed_src)!, name: str(r.name), email: str(r.email), phone: str(r.phone), completed_at: str(r.completed_at), declined_at: str(r.declined_at) });
  }
  if (!Number.isInteger(subId) || subId <= 0 || signers.length !== 2 || new Set(signers.map((x) => x.role)).size !== 2) return null;
  return { submissionId: subId, signers };
}

// ── Webhooks ────────────────────────────────────────────────────────────────

export type DocusealEvent = {
  type: string;
  at: string;
  submissionId: number;
  role: SignerRole | null;
  declineReason: string | null;
  auditLogUrl: string | null;
  combinedDocumentUrl: string | null;
  documentUrls: string[];
  /** The agreement id this site put on the signer (metadata / external_id), if it is one of ours. */
  sentForAgreement: string | null;
};

/** A webhook body ({event_type, timestamp, data}), reduced to what the site acts on; null if it isn't one. */
export function parseEvent(raw: unknown): DocusealEvent | null {
  const b = raw as { event_type?: unknown; timestamp?: unknown; data?: Record<string, unknown> } | null;
  if (!b || typeof b.event_type !== "string" || !b.data || typeof b.data !== "object") return null;
  const d = b.data;
  const isForm = b.event_type.startsWith("form.");
  const sub = (d.submission ?? {}) as Record<string, unknown>;
  const submissionId = Number(isForm ? (d.submission_id ?? sub.id) : d.id);
  const at = typeof b.timestamp === "string" && !Number.isNaN(Date.parse(b.timestamp)) ? new Date(b.timestamp).toISOString() : null;
  if (!Number.isInteger(submissionId) || submissionId <= 0 || !at) return null;
  const docs = Array.isArray(d.documents) ? (d.documents as { url?: unknown }[]).map((x) => str(x?.url)).filter((u): u is string => Boolean(u)) : [];
  return {
    type: b.event_type,
    at,
    submissionId,
    role: isForm && (d.role === "Contractor" || d.role === "Customer") ? d.role : null,
    declineReason: str(d.decline_reason)?.slice(0, 1000) ?? null,
    auditLogUrl: str(d.audit_log_url) ?? str(sub.audit_log_url),
    combinedDocumentUrl: str(d.combined_document_url) ?? str(sub.combined_document_url),
    documentUrls: docs,
    sentForAgreement: ourAgreementId(d),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function ourAgreementId(d: Record<string, unknown>): string | null {
  const meta = (d.metadata ?? {}) as Record<string, unknown>;
  const fromMeta = typeof meta.agreement_id === "string" ? meta.agreement_id : null;
  const fromExt = typeof d.external_id === "string" ? d.external_id.split(":")[0] : null;
  const id = fromMeta ?? fromExt;
  return id && UUID.test(id) ? id.toLowerCase() : null;
}

/** The submission id from a /submissions/html reply that couldn't be read in full, so it can still be withdrawn. */
export function anySubmissionId(resp: unknown): number | null {
  const ok = (x: unknown) => (Number.isInteger(Number(x)) && Number(x) > 0 ? Number(x) : null);
  // An object reply is the submission itself; an array reply is its submitters, each carrying submission_id.
  if (resp && typeof resp === "object" && !Array.isArray(resp)) {
    const o = resp as { id?: unknown; submission_id?: unknown; submitters?: unknown };
    const own = ok(o.submission_id) ?? (Array.isArray(o.submitters) ? ok(o.id) : null);
    if (own) return own;
    resp = o.submitters;
  }
  for (const x of Array.isArray(resp) ? resp : []) {
    const n = ok((x as { submission_id?: unknown } | null)?.submission_id);
    if (n) return n;
  }
  return null;
}

export type Transition =
  | { kind: "none" }
  | { kind: "contractor_signed" }
  | { kind: "signed" }
  | { kind: "declined"; reason: string | null; role: SignerRole | null }
  | { kind: "expired" };

/**
 * What an event does to an agreement in `status`. Only an agreement that is out for signature moves; a signed
 * or void agreement, a draft, or an event that would move it backwards is ignored, so retries and out-of-order
 * deliveries are harmless.
 */
export function transitionFor(status: AgreementSigningStatus, e: DocusealEvent): Transition {
  const out = status === "sent" || status === "contractor_signed";
  if (!out) return { kind: "none" };
  if (e.type === "submission.completed" || (e.type === "form.completed" && e.role === "Customer")) return { kind: "signed" };
  if (e.type === "form.completed" && e.role === "Contractor") return status === "sent" ? { kind: "contractor_signed" } : { kind: "none" };
  if (e.type === "form.declined") return { kind: "declined", reason: e.declineReason, role: e.role };
  if (e.type === "submission.expired") return { kind: "expired" };
  return { kind: "none" };
}

/** What the customer's /sign page shows for an agreement in `status`. */
export function customerStage(status: AgreementSigningStatus): "waiting" | "sign" | "done" | "closed" {
  if (status === "contractor_signed") return "sign";
  if (status === "sent") return "waiting";
  if (status === "signed") return "done";
  return "closed";
}
