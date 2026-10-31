// Server-only: sending a saved agreement version for signature through DocuSeal, and following it to the end.
//
//   send     the newest saved version goes to DocuSeal exactly as stored (POST /submissions/html). The agreement
//            becomes `sent` and its text is frozen. If the owner sent it, the contractor is texted a link to sign
//            in the CRM; a contractor who sent it signs right there.
//   webhook  the contractor signs -> `contractor_signed`, and the customer is texted their link (/sign/<token>,
//            quiet hours apply). The customer signs -> `signed`: the signed PDF and audit log are copied into
//            the private agreements bucket at once (DocuSeal's links expire), and the owner is texted once.
//            Declined or expired -> the owner is texted once and the agreement can be edited and sent again.
//   cancel   archives the DocuSeal submission and puts the agreement back to a draft.
//
// Every webhook is stored once in document_events first; a retry finds it there and does nothing.
import { randomBytes } from "node:crypto";

import { buildSubmissionRequest, readSigners, SENDABLE, transitionFor, type AgreementSigningStatus, type DocusealEvent, type Signer } from "./docuseal-core";
import { archiveSubmission, createHtmlSubmission, docusealConfigured, getSubmission, storeSignedFile } from "./docuseal";
import { parseBody, sendProblems } from "./agreement-doc";
import { canEditJobAgreement } from "./documents";
import { SITE_ORIGIN } from "./env";
import { alertOwner, sendSms, sendSmsResult } from "./notify/send";
import { BUSINESS, firstName, text } from "./notify/format";
import { addAdminEvent } from "./queries";
import { pgAdmin } from "./rest";
import type { Agreement, AgreementVersion, Quote, Session, Staff } from "./types";

const UUID_RE = /^[0-9a-fA-F-]{36}$/;
/** How long a customer has to sign, matching how long a quote is good for. */
const SIGN_DAYS = 30;

export const signLink = (token: string) => `${SITE_ORIGIN}/sign/${token}`;
const hubLink = (quoteId: string) => `${SITE_ORIGIN}/crm/documents/${quoteId}`;

async function patchAgreement(id: string, patch: Record<string, unknown>, onlyIfStatus?: string[]): Promise<boolean> {
  const guard = onlyIfStatus ? `&status=in.(${onlyIfStatus.join(",")})` : "";
  const res = await pgAdmin(`agreements?id=eq.${id}${guard}&select=id`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  return res.ok && ((await res.json()) as unknown[]).length === 1;
}

async function staffRow(id: string | null): Promise<Pick<Staff, "id" | "full_name" | "business_name" | "phone" | "email"> | null> {
  if (!id || !UUID_RE.test(id)) return null;
  const res = await pgAdmin(`staff?id=eq.${id}&select=id,full_name,business_name,phone,email&limit=1`);
  return res.ok ? (((await res.json()) as Staff[])[0] ?? null) : null;
}

export type SendResult = { ok: true } | { ok: false; error: string };

/** Send the agreement's newest saved version for signing. `agreement` and `quote` were read and matched by the caller. */
export async function sendForSigning(session: Session, quote: Quote, agreement: Agreement, expectVersionId: string | null): Promise<SendResult> {
  if (!canEditJobAgreement(session, quote)) return { ok: false, error: "Only the owner or the job's contractor can send this agreement." };
  if (!docusealConfigured()) return { ok: false, error: "Signing isn't set up yet (DocuSeal key missing)." };
  if (!SENDABLE.includes(agreement.status as AgreementSigningStatus)) return { ok: false, error: "This agreement is already out for signature or closed." };
  if (!agreement.current_version_id || agreement.current_version_id !== expectVersionId) {
    return { ok: false, error: "Save your changes first. What gets signed is the newest saved version." };
  }
  if (!quote.assigned_to) return { ok: false, error: "Assign a contractor to the job first: they sign before the customer." };
  if (quote.change_requested_at) return { ok: false, error: "A change order is waiting on the customer. Send after they answer it." };

  const vr = await pgAdmin(`agreement_versions?id=eq.${agreement.current_version_id}&select=*&limit=1`);
  const version = vr.ok ? (((await vr.json()) as AgreementVersion[])[0] ?? null) : null;
  const body = version ? parseBody(version.body) : null;
  if (!version || !body) return { ok: false, error: "Couldn't read the saved version. Reload and try again." };
  const problems = sendProblems(body);
  if (problems.length) return { ok: false, error: `Fix these first: ${problems.map((p) => p.message).join(" ")}` };

  const contractor = await staffRow(quote.assigned_to);
  if (!contractor) return { ok: false, error: "Couldn't read the contractor. Try again." };
  const expireAt = new Date(Date.now() + SIGN_DAYS * 86_400_000).toISOString();
  const title = ["Agreement", body.values.customer_name, body.values.job_address].filter(Boolean).join(" · ");

  const created = await createHtmlSubmission(
    buildSubmissionRequest({
      agreementId: agreement.id,
      version: { id: version.id, version_no: version.version_no, html: version.html, html_sha256: version.html_sha256 },
      title,
      contractor: { name: body.values.contractor_name, email: contractor.email, phone: contractor.phone },
      customer: { name: body.values.customer_name, email: quote.email, phone: quote.phone },
      expireAt,
    }),
  );
  if (!created.ok) return { ok: false, error: `DocuSeal didn't accept it: ${created.error}` };
  const read = readSigners(created.data);
  if (!read) {
    console.error("[signing] unexpected DocuSeal response for agreement", agreement.id);
    return { ok: false, error: "DocuSeal's reply was incomplete. Nothing was sent; try again." };
  }

  const token = randomBytes(16).toString("hex");
  const saved = await patchAgreement(
    agreement.id,
    {
      status: "sent",
      sent_version_id: version.id,
      docuseal_submission_id: read.submissionId,
      signers: read.signers,
      sent_at: new Date().toISOString(),
      contractor_signed_at: null,
      completed_at: null,
      signed_at: null,
      expires_at: expireAt,
      decline_reason: null,
      sign_token: token,
    },
    SENDABLE,
  );
  if (!saved) {
    // Someone else sent it in the meantime, or the write failed: withdraw this submission so nothing dangles.
    await archiveSubmission(read.submissionId);
    return { ok: false, error: "It changed while sending. Reload and check before sending again." };
  }
  await addAdminEvent(quote.id, "agreement_sent", { agreement_id: agreement.id, version_no: version.version_no, by: session.staff.id });

  // The contractor signs first. If someone else pressed Send, they get a text pointing to the job's documents.
  if (session.staff.id !== contractor.id && contractor.phone) {
    await sendSms(
      contractor.phone,
      text([`Please sign the agreement for ${body.values.customer_name} (v${version.version_no}).`, "", hubLink(quote.id)]),
      { quoteId: quote.id, kind: "agreement_sign_crew", role: "crew" },
    ).catch(() => {});
  }
  return { ok: true };
}

/** Withdraw an agreement that is out for signature: archive it in DocuSeal and make it an editable draft again. */
export async function cancelSigning(session: Session, quote: Quote, agreement: Agreement): Promise<SendResult> {
  if (!canEditJobAgreement(session, quote)) return { ok: false, error: "Only the owner or the job's contractor can cancel this." };
  if (agreement.status !== "sent" && agreement.status !== "contractor_signed") return { ok: false, error: "This agreement isn't out for signature." };
  if (agreement.docuseal_submission_id) {
    const r = await archiveSubmission(agreement.docuseal_submission_id);
    if (!r.ok && r.status !== 404) return { ok: false, error: `DocuSeal didn't cancel it: ${r.error}` };
  }
  const ok = await patchAgreement(agreement.id, { status: "pending", sign_token: null, docuseal_submission_id: null, signers: null }, ["sent", "contractor_signed"]);
  if (!ok) return { ok: false, error: "It changed meanwhile (maybe it was just signed). Reload." };
  await addAdminEvent(quote.id, "agreement_cancelled", { agreement_id: agreement.id, by: session.staff.id });
  return { ok: true };
}

type AgreementForEvent = Agreement & { quote: Pick<Quote, "id" | "name" | "phone" | "assigned_to"> | null };

/** Act on one verified DocuSeal webhook. Returns what happened, for the log. */
export async function handleDocusealEvent(e: DocusealEvent, payload: unknown): Promise<string> {
  const ar = await pgAdmin(`agreements?docuseal_submission_id=eq.${e.submissionId}&select=*,quote:quote_requests(id,name,phone,assigned_to)&limit=1`);
  const agreement = ar.ok ? (((await ar.json()) as AgreementForEvent[])[0] ?? null) : null;

  // Recorded once; a retried delivery stops here.
  const rec = await pgAdmin("document_events?on_conflict=submission_id,event_type,event_at", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify({ agreement_id: agreement?.id ?? null, submission_id: e.submissionId, event_type: e.type, event_at: e.at, payload }),
  });
  if (!rec.ok) throw new Error(`document_events insert failed (${rec.status})`);
  if (((await rec.json()) as unknown[]).length === 0) return "duplicate";
  if (!agreement || !agreement.quote) return "no matching agreement";

  const t = transitionFor(agreement.status as AgreementSigningStatus, e);
  const q = agreement.quote;
  const signers = (Array.isArray(agreement.signers) ? agreement.signers : []) as Signer[];
  const mark = (role: "Contractor" | "Customer", patch: Partial<Signer>) => signers.map((s) => (s.role === role ? { ...s, ...patch } : s));

  if (t.kind === "contractor_signed") {
    const ok = await patchAgreement(agreement.id, { status: "contractor_signed", contractor_signed_at: e.at, signers: mark("Contractor", { completed_at: e.at }) }, ["sent"]);
    if (!ok) return "already moved";
    await addAdminEvent(q.id, "agreement_contractor_signed", { agreement_id: agreement.id });
    if (q.phone && agreement.sign_token) {
      await sendSmsResult(
        q.phone,
        text([`Hi ${firstName(q.name)},`, "your contractor has signed your agreement. Please read and sign it here:", "", signLink(agreement.sign_token), "", BUSINESS]),
        { quoteId: q.id, kind: "agreement_sign_customer", role: "customer" },
      ).catch(() => {});
    }
    return "contractor signed";
  }

  if (t.kind === "signed") {
    const stamp = new Date().toISOString().slice(0, 10);
    const base = `signed/${agreement.id}-${stamp}`;
    const pdfUrl = e.combinedDocumentUrl ?? e.documentUrls[0] ?? null;
    const [pdf, audit] = await Promise.all([
      pdfUrl ? storeSignedFile(pdfUrl, `${base}.pdf`, "application/pdf") : Promise.resolve(null),
      e.auditLogUrl ? storeSignedFile(e.auditLogUrl, `${base}-audit.pdf`, "application/pdf") : Promise.resolve(null),
    ]);
    const ok = await patchAgreement(
      agreement.id,
      {
        status: "signed",
        signed_at: e.at,
        completed_at: e.at,
        signers: mark("Customer", { completed_at: e.at }),
        ...(pdf ? { signed_pdf_path: pdf, file_path: pdf } : {}),
        ...(audit ? { audit_log_path: audit } : {}),
      },
      ["sent", "contractor_signed"],
    );
    if (!ok) return "already moved";
    if (!pdf) console.error("[signing] signed but the PDF wasn't stored; fetch it from DocuSeal", agreement.id);
    await addAdminEvent(q.id, "agreement_signed", { agreement_id: agreement.id, stored: Boolean(pdf) });
    await alertOwner(text([`AGREEMENT SIGNED`, "", `${q.name} signed the agreement.`, "", hubLink(q.id)]), null, { quoteId: q.id, kind: "agreement_signed" });
    return "signed";
  }

  if (t.kind === "declined" || t.kind === "expired") {
    const ok = await patchAgreement(
      agreement.id,
      t.kind === "declined"
        ? { status: "declined", decline_reason: t.reason, signers: t.role ? mark(t.role, { declined_at: e.at }) : signers }
        : { status: "expired" },
      ["sent", "contractor_signed"],
    );
    if (!ok) return "already moved";
    await addAdminEvent(q.id, `agreement_${t.kind}`, { agreement_id: agreement.id, ...(t.kind === "declined" ? { by: t.role, reason: t.reason } : {}) });
    const who = t.kind === "declined" ? (t.role === "Contractor" ? "The contractor declined" : `${q.name} declined`) : "Nobody signed in time; it expired";
    await alertOwner(
      text([`AGREEMENT ${t.kind.toUpperCase()}`, "", `${who} the agreement for ${q.name}.`, t.kind === "declined" && t.reason ? `Reason: ${t.reason}` : null, "It can be edited and sent again.", "", hubLink(q.id)]),
      null,
      { quoteId: q.id, kind: `agreement_${t.kind}` },
    );
    return t.kind;
  }
  return "recorded";
}

/**
 * A signed agreement whose PDF didn't make it into storage (DocuSeal's link had expired, or storage was down):
 * fetch fresh links from DocuSeal and copy the files now. Safe to call on every page view; does nothing once stored.
 */
export async function storeMissingSignedCopy(agreement: Agreement): Promise<boolean> {
  if (agreement.status !== "signed" || agreement.signed_pdf_path || !agreement.docuseal_submission_id) return false;
  const sub = await getSubmission(agreement.docuseal_submission_id);
  if (!sub.ok) return false;
  const base = `signed/${agreement.id}-${(agreement.completed_at ?? new Date().toISOString()).slice(0, 10)}`;
  const pdfUrl = sub.data.combined_document_url ?? sub.data.documents?.[0]?.url ?? null;
  const [pdf, audit] = await Promise.all([
    pdfUrl ? storeSignedFile(pdfUrl, `${base}.pdf`, "application/pdf") : Promise.resolve(null),
    sub.data.audit_log_url && !agreement.audit_log_path ? storeSignedFile(sub.data.audit_log_url, `${base}-audit.pdf`, "application/pdf") : Promise.resolve(null),
  ]);
  if (!pdf) return false;
  return patchAgreement(agreement.id, { signed_pdf_path: pdf, file_path: pdf, ...(audit ? { audit_log_path: audit } : {}) }, ["signed"]);
}
