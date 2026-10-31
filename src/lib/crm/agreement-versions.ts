// Server-only: customer agreements written in the CRM, and their saved versions (public.agreement_versions).
//
// Every save is a new numbered version that is never changed afterwards (the database enforces it). Saving goes
// through here only: the caller's right to edit the job is checked, the body is re-read field by field, the job's
// own money replaces whatever the browser sent, and the HTML is rendered here. Then the row is written with the
// service role (signed-in users have no INSERT on the table), and the database numbers and fingerprints it.
// Reads go through the signed-in user's session, so RLS decides who may see a version.
import { todayYmd } from "./clock";
import {
  draftAgreement,
  draftInputFromJob,
  jobDepositCents,
  parseBody,
  renderAgreementHtml,
  type AgreementBody,
  type TemplateSnapshot,
} from "./agreement-doc";
import { resolveTemplateFor } from "./templates";
import { canEditJobAgreement } from "./documents";
import { jobLedger } from "./payments";
import { pgAdmin, pgUser } from "./rest";
import type { Agreement, AgreementVersion, Quote, QuoteOption, QuotePackage, Session, Staff } from "./types";

export { canEditJobAgreement, editableAgreement } from "./documents";

const UUID_RE = /^[0-9a-fA-F-]{36}$/;
const VERSION_COLS = "id,version_no,note,created_by_name,created_at,html_sha256,template_version";

/** Statuses in which an agreement's text can no longer change. */
export const CLOSED_FOR_EDITS = ["sent", "contractor_signed", "signed", "void"];

export type VersionSummary = Pick<
  AgreementVersion,
  "id" | "version_no" | "note" | "created_by_name" | "created_at" | "html_sha256" | "template_version"
>;

async function rowsOrThrow<T>(res: Response, what: string): Promise<T[]> {
  if (!res.ok) throw new Error(`[agreements] couldn't read ${what} (${res.status})`);
  return (await res.json()) as T[];
}

export async function listVersions(session: Session, agreementId: string): Promise<VersionSummary[]> {
  if (!UUID_RE.test(agreementId)) return [];
  const res = await pgUser(`agreement_versions?agreement_id=eq.${agreementId}&select=${VERSION_COLS}&order=version_no.desc`, session.accessToken);
  return res.ok ? ((await res.json()) as VersionSummary[]) : [];
}

export async function getVersion(session: Session, versionId: string): Promise<AgreementVersion | null> {
  if (!UUID_RE.test(versionId)) return null;
  const res = await pgUser(`agreement_versions?id=eq.${versionId}&select=*&limit=1`, session.accessToken);
  if (!res.ok) return null;
  return ((await res.json()) as AgreementVersion[])[0] ?? null;
}

/** The job's money as the agreement must state it: its ledger total and its deposit. */
async function jobMoney(quote: Quote): Promise<{ total: number; deposit: number }> {
  const total = quote.quote_amount != null ? (await jobLedger(quote)).ledger.totalCents : 0;
  return { total, deposit: jobDepositCents(total, quote.deposit_target_cents) };
}

/**
 * A fresh draft from the job as it stands now, from `template` (which decides the clauses and tax wording; the
 * built-in standard when left out). Used for a new agreement and for "Refresh from the job". Throws if any part of
 * the job can't be read, rather than drafting an agreement with a missing contractor or missing lines.
 */
export async function draftFromJob(quote: Quote, template?: TemplateSnapshot): Promise<AgreementBody> {
  const [options, packages, contractor, money] = await Promise.all([
    pgAdmin(`quote_options?quote_id=eq.${quote.id}&select=*&order=sort_order.asc,created_at.asc`).then((r) => rowsOrThrow<QuoteOption>(r, "options")),
    pgAdmin(`quote_packages?quote_id=eq.${quote.id}&select=*`).then((r) => rowsOrThrow<QuotePackage>(r, "packages")),
    quote.assigned_to && UUID_RE.test(quote.assigned_to)
      ? pgAdmin(`staff?id=eq.${quote.assigned_to}&select=full_name,business_name,license_number,phone,payment_methods&limit=1`)
          .then((r) => rowsOrThrow<Staff>(r, "contractor"))
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
    jobMoney(quote),
  ]);
  return draftAgreement({
    ...draftInputFromJob({
      today: todayYmd(),
      quote: { ...quote, estimated_duration: null },
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
      totalCents: money.total,
    }),
    template,
  });
}

async function insertVersion(agreementId: string, body: AgreementBody, note: string | null, who: Session["staff"]) {
  return pgAdmin(`agreement_versions?select=${VERSION_COLS}`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      agreement_id: agreementId,
      // Numbered and fingerprinted by the database; these placeholders only satisfy NOT NULL.
      version_no: 1,
      html_sha256: "0".repeat(64),
      template_version: body.template_version,
      body,
      html: renderAgreementHtml(body),
      note,
      created_by: who.id,
      created_by_name: who.full_name ?? null,
    }),
  });
}

/** The template an agreement is on: the one recorded in its current stored version (service role read). */
async function pinnedTemplate(agreement: Agreement): Promise<TemplateSnapshot | null> {
  if (!agreement.current_version_id || !UUID_RE.test(agreement.current_version_id)) return null;
  const res = await pgAdmin(`agreement_versions?id=eq.${agreement.current_version_id}&agreement_id=eq.${agreement.id}&select=body&limit=1`);
  if (!res.ok) return null;
  const [row] = (await res.json()) as { body: unknown }[];
  return row ? (parseBody(row.body)?.template ?? null) : null;
}

export type SaveResult = { ok: true; version: VersionSummary; body: AgreementBody } | { ok: false; error: string };

/**
 * Save a new version of `agreement` (already read and matched to `quote` by the caller). Refused when the caller
 * may not edit the job, the agreement is out for signature or closed, a change order is pending (the price is
 * about to move), or someone saved a newer version since this editor loaded (`baseVersionId`).
 */
export async function saveVersion(input: {
  session: Session;
  quote: Quote;
  agreement: Agreement;
  raw: unknown;
  note: string;
  baseVersionId: string | null;
}): Promise<SaveResult> {
  const { session, quote, agreement } = input;
  if (!canEditJobAgreement(session, quote)) return { ok: false, error: "Only the owner or the job's contractor can edit this agreement." };
  if (CLOSED_FOR_EDITS.includes(agreement.status)) return { ok: false, error: "This agreement is out for signature or closed, so it can't be changed." };
  if (quote.change_requested_at) return { ok: false, error: "A change order is waiting on the customer. Save after they answer it, so the price is right." };
  if ((agreement.current_version_id ?? null) !== (input.baseVersionId ?? null)) {
    return { ok: false, error: "Someone saved a newer version while you were editing. Reload the page to see it; your changes here aren't saved." };
  }
  const claimed = parseBody(input.raw);
  if (!claimed) return { ok: false, error: "This draft couldn't be read. Reload the page and try again." };
  // The template is pinned to the agreement: it is the one its stored current version was drafted from, never the
  // browser's copy or choice. The body is read again against it, so required clauses, titles and clause types are
  // that template's. Changing template is "Start over from a template", never a save.
  const template = await pinnedTemplate(agreement);
  if (!template) return { ok: false, error: "This agreement's saved version couldn't be read. Reload the page." };
  if (claimed.template.id !== template.id || claimed.template.version_no !== template.version_no) {
    return { ok: false, error: "This draft is on a different template than the agreement. Reload the page." };
  }
  const parsed = parseBody({ ...(input.raw as object), template });
  if (!parsed) return { ok: false, error: "This draft doesn't match its template. Reload the page and try again." };
  const money = await jobMoney(quote);
  const body: AgreementBody = { ...parsed, values: { ...parsed.values, total_cents: money.total, deposit_cents: money.deposit } };
  const res = await insertVersion(agreement.id, body, input.note.trim().slice(0, 300) || null, session.staff);
  if (!res.ok) {
    console.error("[agreements] save version failed", agreement.id, res.status);
    return { ok: false, error: "Couldn't save. Try again." };
  }
  const [v] = (await res.json()) as VersionSummary[];
  // The body as stored (with the job's money), so the editor shows exactly what was saved.
  return v ? { ok: true, version: v, body } : { ok: false, error: "Couldn't save. Try again." };
}

/**
 * Start a customer agreement on a job, written in the CRM, with version 1 drafted from the job. If the job already
 * has one that is still being worked on, that one is used: a double tap never makes two. The agreements table is
 * owner-write under RLS, so the row is made with the service role after the caller's right to edit is checked.
 */
export async function startAgreement(
  session: Session,
  quote: Quote,
  templateId: string | null = null,
): Promise<{ ok: true; agreementId: string } | { ok: false; error: string }> {
  if (!canEditJobAgreement(session, quote)) return { ok: false, error: "Only the owner or the job's contractor can write its agreement." };
  if (quote.change_requested_at) return { ok: false, error: "A change order is waiting on the customer. Write the agreement after they answer it." };
  const open = await pgAdmin(
    `agreements?quote_id=eq.${quote.id}&kind=eq.customer&current_version_id=not.is.null&status=not.in.(signed,void)&select=id&limit=1`,
  );
  const [existing] = open.ok ? ((await open.json()) as { id: string }[]) : [];
  if (existing) return { ok: true, agreementId: existing.id };
  const drafted = await draftForNew(quote, templateId);
  if (!drafted.ok) return drafted;
  return createAgreement(session, quote, drafted.body);
}

/** A new agreement's version 1, drafted from the job and the chosen template (or the job's default). */
async function draftForNew(quote: Quote, templateId: string | null): Promise<{ ok: true; body: AgreementBody } | { ok: false; error: string }> {
  try {
    const template = await resolveTemplateFor(templateId, quote.service);
    if ("error" in template) return { ok: false, error: template.error };
    return { ok: true, body: await draftFromJob(quote, template) };
  } catch (e) {
    console.error((e as Error).message);
    return { ok: false, error: "Couldn't read the whole job to draft from. Try again." };
  }
}

/** The agreement row and its version 1. If the version can't be written, the row is removed again. */
async function createAgreement(session: Session, quote: Quote, body: AgreementBody): Promise<{ ok: true; agreementId: string } | { ok: false; error: string }> {
  const ins = await pgAdmin("agreements?select=id", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ kind: "customer", quote_id: quote.id, title: `Customer agreement for ${quote.name}`.slice(0, 200), status: "pending", created_by: session.staff.id }),
  });
  const [ag] = ins.ok ? ((await ins.json()) as { id: string }[]) : [];
  if (!ag) return { ok: false, error: "Couldn't start the agreement. Try again." };
  const v = await insertVersion(ag.id, body, `Drafted from the job (${body.template.name}${body.template.version_no ? ` v${body.template.version_no}` : ""})`, session.staff);
  if (!v.ok) {
    console.error("[agreements] first version failed", ag.id, v.status);
    await pgAdmin(`agreements?id=eq.${ag.id}`, { method: "DELETE" });
    return { ok: false, error: "Couldn't start the agreement. Try again." };
  }
  return { ok: true, agreementId: ag.id };
}

/**
 * Set an agreement aside and start a fresh one from a template. Everything that can fail is done first (a pending
 * change order, the template, reading the job, writing the new agreement); only then is the old one marked void,
 * kept with its whole history under "Earlier agreements". If the old one changed meanwhile (sent, signed), the new
 * one is removed again, so a job is never left without its editable agreement. Only for a draft, or one that was
 * declined or expired.
 */
export async function archiveAndRestart(
  session: Session,
  quote: Quote,
  agreement: Agreement,
  templateId: string | null,
): Promise<{ ok: true; agreementId: string } | { ok: false; error: string }> {
  if (!canEditJobAgreement(session, quote)) return { ok: false, error: "Only the owner or the job's contractor can do this." };
  if (!["pending", "declined", "expired"].includes(agreement.status)) {
    return { ok: false, error: "Only a draft, or one that was declined or expired, can be set aside. Cancel the signing first." };
  }
  if (quote.change_requested_at) return { ok: false, error: "A change order is waiting on the customer. Start over after they answer it." };
  const drafted = await draftForNew(quote, templateId);
  if (!drafted.ok) return drafted;
  const created = await createAgreement(session, quote, drafted.body);
  if (!created.ok) return created;
  const note = `Set aside on ${todayYmd()} to start over from a template.`;
  const res = await pgAdmin(`agreements?id=eq.${agreement.id}&status=in.(pending,declined,expired)&select=id`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ status: "void", notes: agreement.notes ? `${agreement.notes}\n${note}`.slice(0, 2000) : note }),
  });
  const moved = res.ok && ((await res.json()) as unknown[]).length === 1;
  if (!moved) {
    await pgAdmin(`agreements?id=eq.${created.agreementId}`, { method: "DELETE" });
    return { ok: false, error: "It changed meanwhile. Reload and try again." };
  }
  return created;
}
