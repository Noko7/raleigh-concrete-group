"use server";

import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/crm/auth";
import type { AgreementBody } from "@/lib/crm/agreement-doc";
import {
  canEditJobAgreement,
  draftFromJob,
  getVersion,
  saveVersion,
  startAgreement,
  type VersionSummary,
} from "@/lib/crm/agreement-versions";
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

export async function startAgreementAction(quoteId: string): Promise<{ ok: boolean; error?: string }> {
  const ctx = await jobFor(quoteId);
  if (!ctx) return { ok: false, error: "This job isn't available." };
  const r = await startAgreement(ctx.session, ctx.quote);
  if (r.ok) refresh(quoteId);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

export async function saveVersionAction(
  quoteId: string,
  agreementId: string,
  body: AgreementBody,
  note: string,
): Promise<{ ok: true; version: VersionSummary } | { ok: false; error: string }> {
  const ctx = await jobFor(quoteId);
  if (!ctx) return { ok: false, error: "This job isn't available." };
  if (!canEditJobAgreement(ctx.session, ctx.quote)) return { ok: false, error: "Only the owner or the job's contractor can edit this agreement." };
  const ag = await getAgreement(ctx.session, agreementId);
  if (!ag || ag.quote_id !== quoteId || ag.kind !== "customer") return { ok: false, error: "This agreement isn't on this job." };
  if (ag.status === "signed" || ag.status === "void") return { ok: false, error: "This agreement is closed. Start an amendment instead." };
  const r = await saveVersion(ctx.session, agreementId, body, note);
  if (r.ok) refresh(quoteId);
  return r;
}

/** The job as it stands now, as a draft, so the editor can bring its values up to date without losing edits. */
export async function draftFromJobAction(quoteId: string): Promise<{ ok: true; body: AgreementBody } | { ok: false; error: string }> {
  const ctx = await jobFor(quoteId);
  if (!ctx) return { ok: false, error: "This job isn't available." };
  if (!canEditJobAgreement(ctx.session, ctx.quote)) return { ok: false, error: "Only the owner or the job's contractor can edit this agreement." };
  return { ok: true, body: await draftFromJob(ctx.quote) };
}

/** One saved version, as stored, for viewing, comparing or restoring. RLS decides whether the caller may read it. */
export async function getVersionAction(
  versionId: string,
): Promise<{ ok: true; body: AgreementBody; html: string; version_no: number } | { ok: false; error: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Sign in again." };
  const v = await getVersion(session, versionId);
  if (!v) return { ok: false, error: "That version isn't available." };
  return { ok: true, body: v.body as AgreementBody, html: v.html, version_no: v.version_no };
}
