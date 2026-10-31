// Server-only: customer agreements written in the CRM, and their saved versions (public.agreement_versions).
//
// Every save is a new numbered version that is never changed afterwards (the database enforces it). The HTML is
// rendered HERE from the parsed body, never taken from the browser, so the stored document is always exactly what
// the body says; the database fingerprints it. Reads and saves go through the signed-in user's session, so RLS
// decides who may see or save: the owner, or the contractor assigned to the job.
import { todayYmd } from "./clock";
import {
  AGREEMENT_TEMPLATE_VERSION,
  draftAgreement,
  draftInputFromJob,
  parseBody,
  renderAgreementHtml,
  type AgreementBody,
} from "./agreement-doc";
import { jobLedger } from "./payments";
import { pgAdmin, pgUser } from "./rest";
import type { AgreementVersion, Quote, QuoteOption, QuotePackage, Session, Staff } from "./types";

import { canEditJobAgreement } from "./documents";
export { canEditJobAgreement, editableAgreement } from "./documents";

const UUID_RE = /^[0-9a-fA-F-]{36}$/;

export type VersionSummary = Pick<
  AgreementVersion,
  "id" | "version_no" | "note" | "created_by_name" | "created_at" | "html_sha256" | "template_version"
>;

async function rows<T>(res: Response): Promise<T[]> {
  return res.ok ? ((await res.json()) as T[]) : [];
}

export async function listVersions(session: Session, agreementId: string): Promise<VersionSummary[]> {
  if (!UUID_RE.test(agreementId)) return [];
  return rows<VersionSummary>(
    await pgUser(
      `agreement_versions?agreement_id=eq.${agreementId}&select=id,version_no,note,created_by_name,created_at,html_sha256,template_version&order=version_no.desc`,
      session.accessToken,
    ),
  );
}

export async function getVersion(session: Session, versionId: string): Promise<AgreementVersion | null> {
  if (!UUID_RE.test(versionId)) return null;
  const [v] = await rows<AgreementVersion>(await pgUser(`agreement_versions?id=eq.${versionId}&select=*&limit=1`, session.accessToken));
  return v ?? null;
}

/** A fresh draft from the job as it stands now. Used for a new agreement and for "Refresh from the job". */
export async function draftFromJob(quote: Quote): Promise<AgreementBody> {
  const [options, packages, contractor, money] = await Promise.all([
    rows<QuoteOption>(await pgAdmin(`quote_options?quote_id=eq.${quote.id}&select=*&order=sort_order.asc`)),
    rows<QuotePackage>(await pgAdmin(`quote_packages?quote_id=eq.${quote.id}&select=*`)),
    quote.assigned_to && UUID_RE.test(quote.assigned_to)
      ? rows<Staff>(
          await pgAdmin(`staff?id=eq.${quote.assigned_to}&select=full_name,business_name,license_number,phone,payment_methods&limit=1`),
        ).then((r) => r[0] ?? null)
      : Promise.resolve(null),
    quote.quote_amount != null ? jobLedger(quote) : Promise.resolve(null),
  ]);
  return draftAgreement(
    draftInputFromJob({
      today: todayYmd(),
      quote: { ...quote, estimated_duration: quote.estimated_duration ?? null },
      options,
      packages,
      contractor: contractor
        ? {
            full_name: contractor.full_name,
            business_name: contractor.business_name ?? null,
            license_number: contractor.license_number ?? null,
            phone: contractor.phone,
            payment_methods: contractor.payment_methods ?? null,
          }
        : null,
      totalCents: money?.ledger.totalCents ?? 0,
    }),
  );
}

export type SaveResult = { ok: true; version: VersionSummary } | { ok: false; error: string };

/** Save a new version. The body is re-checked and the HTML rendered here; RLS decides whether this user may. */
export async function saveVersion(session: Session, agreementId: string, raw: unknown, note: string): Promise<SaveResult> {
  if (!UUID_RE.test(agreementId)) return { ok: false, error: "Unknown agreement." };
  const body = parseBody(raw);
  if (!body) return { ok: false, error: "This draft couldn't be read. Refresh the page and try again." };
  const res = await pgUser("agreement_versions?select=id,version_no,note,created_by_name,created_at,html_sha256,template_version", session.accessToken, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      agreement_id: agreementId,
      // Numbered, stamped and fingerprinted by the database; these placeholders satisfy NOT NULL.
      version_no: 1,
      html_sha256: "0".repeat(64),
      template_version: body.template_version || AGREEMENT_TEMPLATE_VERSION,
      body,
      html: renderAgreementHtml(body),
      note: note.trim().slice(0, 300) || null,
    }),
  });
  if (!res.ok) {
    console.error("[agreements] save version failed", agreementId, res.status, (await res.text()).slice(0, 200));
    return { ok: false, error: res.status === 403 || res.status === 401 ? "You can't edit this agreement." : "Couldn't save. Try again." };
  }
  const [v] = (await res.json()) as VersionSummary[];
  return v ? { ok: true, version: v } : { ok: false, error: "Couldn't save. Try again." };
}

/**
 * Start a customer agreement on a job, written in the CRM, with version 1 drafted from the job. The agreements
 * table is owner-write under RLS, so the row is made with the service role after the caller's right to edit this
 * job is checked; version 1 is stamped with the caller.
 */
export async function startAgreement(session: Session, quote: Quote): Promise<{ ok: true; agreementId: string } | { ok: false; error: string }> {
  if (!canEditJobAgreement(session, quote)) return { ok: false, error: "Only the owner or the job's contractor can write its agreement." };
  const body = await draftFromJob(quote);
  const ins = await pgAdmin("agreements?select=id", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ kind: "customer", quote_id: quote.id, title: `Customer agreement for ${quote.name}`.slice(0, 200), status: "pending", created_by: session.staff.id }),
  });
  const [ag] = await rows<{ id: string }>(ins);
  if (!ag) return { ok: false, error: "Couldn't start the agreement. Try again." };
  const v = await pgAdmin("agreement_versions", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      agreement_id: ag.id,
      version_no: 1,
      html_sha256: "0".repeat(64),
      template_version: body.template_version,
      body,
      html: renderAgreementHtml(body),
      note: "Drafted from the job",
      created_by: session.staff.id,
      created_by_name: session.staff.full_name ?? null,
    }),
  });
  if (!v.ok) {
    console.error("[agreements] first version failed", ag.id, v.status);
    await pgAdmin(`agreements?id=eq.${ag.id}`, { method: "DELETE" });
    return { ok: false, error: "Couldn't start the agreement. Try again." };
  }
  return { ok: true, agreementId: ag.id };
}
