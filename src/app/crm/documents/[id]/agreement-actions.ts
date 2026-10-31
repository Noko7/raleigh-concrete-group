"use server";

import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/crm/auth";
import { parseBody, type AgreementBody } from "@/lib/crm/agreement-doc";
import {
  archiveAndRestart,
  canEditJobAgreement,
  draftFromJob,
  getVersion,
  saveVersion,
  startAgreement,
  type VersionSummary,
} from "@/lib/crm/agreement-versions";
import { cancelSigning, sendForSigning } from "@/lib/crm/agreement-signing";
import { getAgreement, getQuote } from "@/lib/crm/queries";

// The agreement editor's server side. Every write is checked twice: here (owner, or the job's contractor) and by
// RLS on agreement_versions. Nothing the browser sends is stored as HTML: saveVersion renders it from the body.

function refresh(quoteId: string) {
  revalidatePath(`/crm/documents/${quoteId}`);
  revalidatePath("/crm/documents");
}

async function jobFor(quoteId: string) {
  const session = await getSession();
  if (!session) return null;
  const quote = await getQuote(session, quoteId);
  if (!quote) return null;
  return { session, quote };
}

const templateIdOrNull = (x: unknown) => (typeof x === "string" && /^[0-9a-fA-F-]{36}$/.test(x) ? x : null);

export async function startAgreementAction(quoteId: string, templateId: string | null = null): Promise<{ ok: boolean; error?: string }> {
  const ctx = await jobFor(quoteId);
  if (!ctx) return { ok: false, error: "This job isn't available." };
  const r = await startAgreement(ctx.session, ctx.quote, templateIdOrNull(templateId));
  if (r.ok) refresh(quoteId);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

/** Set this agreement aside (kept under "Earlier agreements") and draft a new one from a template. */
export async function archiveAndRestartAction(quoteId: string, agreementId: string, templateId: string | null): Promise<{ ok: boolean; error?: string }> {
  const ctx = await jobFor(quoteId);
  if (!ctx) return { ok: false, error: "This job isn't available." };
  const ag = await getAgreement(ctx.session, agreementId);
  if (!ag || ag.quote_id !== quoteId || ag.kind !== "customer" || !ag.current_version_id) return { ok: false, error: "This agreement isn't on this job." };
  const r = await archiveAndRestart(ctx.session, ctx.quote, ag, templateIdOrNull(templateId));
  refresh(quoteId);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

export async function saveVersionAction(
  quoteId: string,
  agreementId: string,
  body: AgreementBody,
  note: string,
  baseVersionId: string | null,
): Promise<{ ok: true; version: VersionSummary; body: AgreementBody } | { ok: false; error: string }> {
  const ctx = await jobFor(quoteId);
  if (!ctx) return { ok: false, error: "This job isn't available." };
  const ag = await getAgreement(ctx.session, agreementId);
  if (!ag || ag.quote_id !== quoteId || ag.kind !== "customer") return { ok: false, error: "This agreement isn't on this job." };
  const r = await saveVersion({ session: ctx.session, quote: ctx.quote, agreement: ag, raw: body, note, baseVersionId });
  if (r.ok) refresh(quoteId);
  return r;
}

/** The job as it stands now, as a draft, so the editor can bring its values up to date without losing edits. */
export async function draftFromJobAction(quoteId: string): Promise<{ ok: true; body: AgreementBody } | { ok: false; error: string }> {
  const ctx = await jobFor(quoteId);
  if (!ctx) return { ok: false, error: "This job isn't available." };
  if (!canEditJobAgreement(ctx.session, ctx.quote)) return { ok: false, error: "Only the owner or the job's contractor can edit this agreement." };
  try {
    return { ok: true, body: await draftFromJob(ctx.quote) };
  } catch (e) {
    console.error((e as Error).message);
    return { ok: false, error: "Couldn't read the whole job. Try again." };
  }
}

/** One saved version, as stored, for viewing, comparing or restoring. RLS decides whether the caller may read it. */
export async function getVersionAction(
  versionId: string,
): Promise<{ ok: true; body: AgreementBody; html: string; version_no: number } | { ok: false; error: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Sign in again." };
  const v = await getVersion(session, versionId);
  if (!v) return { ok: false, error: "That version isn't available." };
  // Read through parseBody so a version saved before templates existed comes back with the built-in template.
  const body = parseBody(v.body);
  if (!body) return { ok: false, error: "That version couldn't be read." };
  return { ok: true, body, html: v.html, version_no: v.version_no };
}

/** Send the newest saved version for signing (contractor first, then the customer). */
export async function sendForSigningAction(quoteId: string, agreementId: string, versionId: string | null): Promise<{ ok: boolean; error?: string }> {
  const ctx = await jobFor(quoteId);
  if (!ctx) return { ok: false, error: "This job isn't available." };
  const ag = await getAgreement(ctx.session, agreementId);
  if (!ag || ag.quote_id !== quoteId || ag.kind !== "customer") return { ok: false, error: "This agreement isn't on this job." };
  const r = await sendForSigning(ctx.session, ctx.quote, ag, versionId);
  refresh(quoteId);
  return r.ok ? { ok: true } : r;
}

/** Withdraw it from signing: archived in DocuSeal, editable again here. */
export async function cancelSigningAction(quoteId: string, agreementId: string): Promise<{ ok: boolean; error?: string }> {
  const ctx = await jobFor(quoteId);
  if (!ctx) return { ok: false, error: "This job isn't available." };
  const ag = await getAgreement(ctx.session, agreementId);
  if (!ag || ag.quote_id !== quoteId || ag.kind !== "customer") return { ok: false, error: "This agreement isn't on this job." };
  const r = await cancelSigning(ctx.session, ctx.quote, ag);
  refresh(quoteId);
  return r.ok ? { ok: true } : r;
}
