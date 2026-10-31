// Server-only: sending a saved agreement version for signature through DocuSeal, and following it to the end.
//
//   send     the newest saved version goes to DocuSeal exactly as stored (POST /submissions/html). The agreement
//            becomes `sent` and its text is frozen. If the owner sent it, the contractor is texted a link to sign
//            in the CRM; a contractor who sent it signs right there.
//            DocuSeal also emails the signers in order (order "preserved"): the contractor at once, the customer
//            once the contractor has signed. A submission DocuSeal created but this site never recorded (a send
//            that timed out) is withdrawn when its first signature arrives, so it can't go on to the customer.
//   webhook  the contractor signs -> `contractor_signed`, and the customer is texted their link (/sign/<token>,
//            quiet hours apply). The customer signs -> `signed`: the signed PDF and audit log are copied into
//            the private agreements bucket at once (DocuSeal's links expire), and the owner is texted once.
//            Declined or expired -> the owner is texted once and the agreement can be edited and sent again.
//   cancel   archives the DocuSeal submission and puts the agreement back to a draft.
//
// What lets someone sign (each signer's DocuSeal link, the customer's token) lives in agreement_signing, which only
// the server can read: each person is handed their own link and nobody else's.
//
// Webhooks: each is recorded in document_events, acted on, and only then marked processed. A retry of one that
// failed part way is acted on again; every status change is guarded on the status it expects, so acting twice
// moves nothing twice and texts nobody twice.
import { randomBytes } from "node:crypto";

import { anySubmissionId, buildSubmissionRequest, readSigners, SENDABLE, transitionFor, type AgreementSigningStatus, type DocusealEvent, type Signer } from "./docuseal-core";
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

/** The server-only signing record of an agreement that is (or was) out for signature. */
export type SigningSecrets = {
  agreement_id: string;
  submission_id: number;
  sign_token: string;
  contractor_staff_id: string | null;
  signers: Signer[];
  customer_texted_at: string | null;
};

export async function signingFor(agreementId: string): Promise<SigningSecrets | null> {
  if (!UUID_RE.test(agreementId)) return null;
  const res = await pgAdmin(`agreement_signing?agreement_id=eq.${agreementId}&select=*&limit=1`);
  if (!res.ok) throw new Error(`[signing] couldn't read the signing record (${res.status})`);
  return ((await res.json()) as SigningSecrets[])[0] ?? null;
}

export async function signingByToken(token: string): Promise<SigningSecrets | null> {
  if (!/^[0-9a-f]{32}$/.test(token)) return null;
  const res = await pgAdmin(`agreement_signing?sign_token=eq.${token}&select=*&limit=1`);
  return res.ok ? (((await res.json()) as SigningSecrets[])[0] ?? null) : null;
}

/**
 * Update an agreement only if it is still in one of `onlyIfStatus` (and still on `versionId`, when given). True
 * when it moved; false when it had already moved on. Throws when the write itself failed, so a webhook is retried.
 */
async function patchAgreement(id: string, patch: Record<string, unknown>, onlyIfStatus?: string[], versionId?: string): Promise<boolean> {
  const guard = (onlyIfStatus ? `&status=in.(${onlyIfStatus.join(",")})` : "") + (versionId ? `&current_version_id=eq.${versionId}` : "");
  const res = await pgAdmin(`agreements?id=eq.${id}${guard}&select=id`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`[signing] agreement update failed (${res.status})`);
  return ((await res.json()) as unknown[]).length === 1;
}

async function patchSigning(agreementId: string, patch: Record<string, unknown>): Promise<void> {
  const res = await pgAdmin(`agreement_signing?agreement_id=eq.${agreementId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch) });
  if (!res.ok) throw new Error(`[signing] signing record update failed (${res.status})`);
}

async function staffRow(id: string | null): Promise<Pick<Staff, "id" | "full_name" | "business_name" | "phone" | "email"> | null> {
  if (!id || !UUID_RE.test(id)) return null;
  const res = await pgAdmin(`staff?id=eq.${id}&select=id,full_name,business_name,phone,email&limit=1`);
  return res.ok ? (((await res.json()) as Staff[])[0] ?? null) : null;
}

async function withdraw(submissionId: number, why: string) {
  const r = await archiveSubmission(submissionId);
  if (!r.ok && r.status !== 404) console.error("[signing] COULDN'T ARCHIVE a DocuSeal submission; archive it by hand:", submissionId, why);
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

  const vr = await pgAdmin(`agreement_versions?id=eq.${agreement.current_version_id}&agreement_id=eq.${agreement.id}&select=*&limit=1`);
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
    // DocuSeal emails the first signer as soon as it creates the submission, so an unreadable reply is withdrawn
    // (its link then says it's no longer active) rather than left live and untracked.
    console.error("[signing] unexpected DocuSeal response for agreement", agreement.id);
    const stray = anySubmissionId(created.data);
    if (stray) await withdraw(stray, "reply couldn't be read");
    else console.error("[signing] COULDN'T WITHDRAW an unreadable DocuSeal submission; find it in DocuSeal and archive it by hand. Agreement", agreement.id);
    return { ok: false, error: "DocuSeal's reply was incomplete, so the send was withdrawn. If the contractor got an email for it, that link won't work. Try again." };
  }

  // The links first (server-only), then the agreement, guarded on its status AND on the version that was sent,
  // so a save that slipped in meanwhile stops this send instead of signing an older version.
  const token = randomBytes(16).toString("hex");
  // The row left by the previous, finished send (declined or expired) is cleared, by its own submission id, so
  // a send racing this one can never clear this one's links; if two race, the second insert fails on the key.
  if (agreement.docuseal_submission_id) {
    await pgAdmin(`agreement_signing?agreement_id=eq.${agreement.id}&submission_id=eq.${agreement.docuseal_submission_id}`, { method: "DELETE" });
  }
  const links = await pgAdmin("agreement_signing", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ agreement_id: agreement.id, submission_id: read.submissionId, sign_token: token, contractor_staff_id: contractor.id, signers: read.signers, customer_texted_at: null }),
  });
  let saved = false;
  try {
    saved =
      links.ok &&
      (await patchAgreement(
        agreement.id,
        {
          status: "sent",
          sent_version_id: version.id,
          docuseal_submission_id: read.submissionId,
          sent_at: new Date().toISOString(),
          contractor_signed_at: null,
          completed_at: null,
          signed_at: null,
          expires_at: expireAt,
          decline_reason: null,
        },
        SENDABLE,
        version.id,
      ));
  } catch (e) {
    console.error((e as Error).message);
  }
  if (!saved) {
    // Only this send's links are removed: a send that won meanwhile keeps its own.
    await pgAdmin(`agreement_signing?agreement_id=eq.${agreement.id}&submission_id=eq.${read.submissionId}`, { method: "DELETE" });
    await withdraw(read.submissionId, "send didn't complete");
    return { ok: false, error: "It changed while sending (a new save, or someone else sent it). Reload and check before sending again." };
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
  // The links die first: if that fails, nothing else changes and Cancel can simply be pressed again. (Cleared the
  // other way round, a leftover row would block every later send.)
  const del = await pgAdmin(`agreement_signing?agreement_id=eq.${agreement.id}`, { method: "DELETE" });
  if (!del.ok) return { ok: false, error: "Couldn't cancel just now. Try again." };
  let ok = false;
  try {
    ok = await patchAgreement(agreement.id, { status: "pending", docuseal_submission_id: null }, ["sent", "contractor_signed"]);
  } catch (e) {
    console.error((e as Error).message);
  }
  if (!ok) return { ok: false, error: "It changed meanwhile (maybe it was just signed). Reload." };
  await addAdminEvent(quote.id, "agreement_cancelled", { agreement_id: agreement.id, by: session.staff.id });
  return { ok: true };
}

type AgreementForEvent = Agreement & { quote: Pick<Quote, "id" | "name" | "phone" | "assigned_to"> | null };

/** Act on one verified DocuSeal webhook. Returns what happened, for the log; throws (so DocuSeal retries) on failure. */
export async function handleDocusealEvent(e: DocusealEvent, payload: unknown): Promise<string> {
  const key = `submission_id=eq.${e.submissionId}&event_type=eq.${encodeURIComponent(e.type)}&signer_role=eq.${e.role ?? ""}&event_at=eq.${encodeURIComponent(e.at)}`;
  const seen = await pgAdmin(`document_events?${key}&select=id,processed_at&limit=1`);
  if (!seen.ok) throw new Error(`[signing] couldn't read document_events (${seen.status})`);
  const [prior] = (await seen.json()) as { id: string; processed_at: string | null }[];
  if (prior?.processed_at) return "duplicate";

  const ar = await pgAdmin(`agreements?docuseal_submission_id=eq.${e.submissionId}&select=*,quote:quote_requests(id,name,phone,assigned_to)&limit=1`);
  if (!ar.ok) throw new Error(`[signing] couldn't read the agreement (${ar.status})`);
  const agreement = ((await ar.json()) as AgreementForEvent[])[0] ?? null;

  if (!prior) {
    const rec = await pgAdmin("document_events?on_conflict=submission_id,event_type,signer_role,event_at", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify({ agreement_id: agreement?.id ?? null, submission_id: e.submissionId, event_type: e.type, signer_role: e.role ?? "", event_at: e.at, payload }),
    });
    if (!rec.ok) throw new Error(`[signing] document_events insert failed (${rec.status})`);
  }

  const outcome = agreement?.quote ? await act(agreement as AgreementForEvent & { quote: NonNullable<AgreementForEvent["quote"]> }, e) : await untracked(e);
  const done = await pgAdmin(`document_events?${key}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ processed_at: new Date().toISOString() }) });
  if (!done.ok) throw new Error(`[signing] couldn't mark the event processed (${done.status})`);
  return outcome;
}

/**
 * A signature on a submission this site sent but never recorded (the send timed out after DocuSeal had already
 * created it and emailed the contractor). DocuSeal would email the customer next, for a signature the site would
 * never see, so it is withdrawn. A submission whose links were saved is a send still finishing: left alone.
 */
async function untracked(e: DocusealEvent): Promise<string> {
  if (e.type !== "form.completed" || !e.sentForAgreement) return "no matching agreement";
  const known = await pgAdmin(`agreement_signing?submission_id=eq.${e.submissionId}&select=agreement_id&limit=1`);
  if (!known.ok) throw new Error(`[signing] couldn't read agreement_signing (${known.status})`);
  if (((await known.json()) as unknown[]).length) return "no matching agreement (send still finishing)";
  await withdraw(e.submissionId, `untracked submission for agreement ${e.sentForAgreement}`);
  return "untracked submission withdrawn";
}

async function act(agreement: AgreementForEvent & { quote: NonNullable<AgreementForEvent["quote"]> }, e: DocusealEvent): Promise<string> {
  const t = transitionFor(agreement.status as AgreementSigningStatus, e);
  if (t.kind === "none") return "recorded";
  const q = agreement.quote;
  const links = await signingFor(agreement.id);
  const signers = links?.signers ?? [];
  const mark = (role: "Contractor" | "Customer", patch: Partial<Signer>) => signers.map((s) => (s.role === role ? { ...s, ...patch } : s));

  if (t.kind === "contractor_signed") {
    const moved = await patchAgreement(agreement.id, { status: "contractor_signed", contractor_signed_at: e.at }, ["sent"]);
    if (links) await patchSigning(agreement.id, { signers: mark("Contractor", { completed_at: e.at }) });
    if (!moved) return "already moved";
    await addAdminEvent(q.id, "agreement_contractor_signed", { agreement_id: agreement.id });
    if (q.phone && links) {
      const sent = await sendSmsResult(
        q.phone,
        text([`Hi ${firstName(q.name)},`, "your contractor has signed your agreement. Please read and sign it here:", "", signLink(links.sign_token), "", BUSINESS]),
        { quoteId: q.id, kind: "agreement_sign_customer", role: "customer" },
      ).catch(() => null);
      if (sent?.ok) await patchSigning(agreement.id, { customer_texted_at: new Date().toISOString() });
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
    const moved = await patchAgreement(
      agreement.id,
      { status: "signed", signed_at: e.at, completed_at: e.at, ...(pdf ? { signed_pdf_path: pdf, file_path: pdf } : {}), ...(audit ? { audit_log_path: audit } : {}) },
      ["sent", "contractor_signed"],
    );
    if (links) await patchSigning(agreement.id, { signers: mark("Customer", { completed_at: e.at }) });
    if (!moved) return "already moved";
    if (!pdf) console.error("[signing] signed but the PDF wasn't stored; it is fetched again on the next page view", agreement.id);
    await addAdminEvent(q.id, "agreement_signed", { agreement_id: agreement.id, stored: Boolean(pdf) });
    await alertOwner(text([`AGREEMENT SIGNED`, "", `${q.name} signed the agreement.`, "", hubLink(q.id)]), null, { quoteId: q.id, kind: "agreement_signed" });
    return "signed";
  }

  // Declined or expired.
  const moved = await patchAgreement(
    agreement.id,
    t.kind === "declined" ? { status: "declined", decline_reason: t.reason } : { status: "expired" },
    ["sent", "contractor_signed"],
  );
  if (links && t.kind === "declined" && t.role) await patchSigning(agreement.id, { signers: mark(t.role, { declined_at: e.at }) });
  if (!moved) return "already moved";
  await addAdminEvent(q.id, `agreement_${t.kind}`, { agreement_id: agreement.id, ...(t.kind === "declined" ? { by: t.role, reason: t.reason } : {}) });
  const who = t.kind === "declined" ? (t.role === "Contractor" ? "The contractor declined" : `${q.name} declined`) : "Nobody signed in time; it expired:";
  await alertOwner(
    text([`AGREEMENT ${t.kind.toUpperCase()}`, "", `${who} the agreement for ${q.name}.`, t.kind === "declined" && t.reason ? `Reason: ${t.reason}` : null, "It can be edited and sent again.", "", hubLink(q.id)]),
    null,
    { quoteId: q.id, kind: `agreement_${t.kind}` },
  );
  return t.kind;
}

/**
 * Catch up with DocuSeal when a webhook went missing: a signed agreement whose PDF didn't reach storage, or one
 * that DocuSeal says the contractor (or customer) has signed while we still show it waiting. Called on page views;
 * does nothing when everything already agrees. Errors are logged, never shown.
 */
export async function reconcileWithDocuseal(agreement: Agreement): Promise<boolean> {
  try {
    if (!agreement.docuseal_submission_id) return false;
    const needsFile = agreement.status === "signed" && !agreement.signed_pdf_path;
    const waiting = agreement.status === "sent" || agreement.status === "contractor_signed";
    if (!needsFile && !waiting) return false;
    const sub = await getSubmission(agreement.docuseal_submission_id, 5_000);
    if (!sub.ok) return false;
    if (waiting) {
      const done = (sub.data.submitters ?? []).filter((s) => s.completed_at && (s.role === "Contractor" || s.role === "Customer"));
      const at = (role: string) => done.find((s) => s.role === role)?.completed_at ?? null;
      const fake = (type: string, role: "Contractor" | "Customer" | null, when: string): DocusealEvent => ({
        type, at: new Date(when).toISOString(), submissionId: agreement.docuseal_submission_id!, role, declineReason: null,
        auditLogUrl: sub.data.audit_log_url ?? null, combinedDocumentUrl: sub.data.combined_document_url ?? null,
        documentUrls: (sub.data.documents ?? []).map((d) => d.url).filter((u): u is string => Boolean(u)),
        sentForAgreement: agreement.id,
      });
      const c = at("Contractor");
      const k = at("Customer");
      if (sub.data.status === "completed" && k) return (await handleDocusealEvent(fake("submission.completed", null, k), { reconciled: true })) === "signed";
      if (agreement.status === "sent" && c) return (await handleDocusealEvent(fake("form.completed", "Contractor", c), { reconciled: true })) === "contractor signed";
      return false;
    }
    const base = `signed/${agreement.id}-${(agreement.completed_at ?? new Date().toISOString()).slice(0, 10)}`;
    const pdfUrl = sub.data.combined_document_url ?? sub.data.documents?.[0]?.url ?? null;
    const [pdf, audit] = await Promise.all([
      pdfUrl ? storeSignedFile(pdfUrl, `${base}.pdf`, "application/pdf") : Promise.resolve(null),
      sub.data.audit_log_url && !agreement.audit_log_path ? storeSignedFile(sub.data.audit_log_url, `${base}-audit.pdf`, "application/pdf") : Promise.resolve(null),
    ]);
    if (!pdf) return false;
    return await patchAgreement(agreement.id, { signed_pdf_path: pdf, file_path: pdf, ...(audit ? { audit_log_path: audit } : {}) }, ["signed"]);
  } catch (e) {
    console.error("[signing] reconcile failed", agreement.id, (e as Error).message);
    return false;
  }
}
