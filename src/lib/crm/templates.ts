// Server-only: agreement templates (public.document_templates and document_template_versions).
//
// The owner creates, edits, clones, archives and restores templates in the Documents hub. Every save is a new
// numbered template version that is never changed afterwards (the database enforces it), so the wording a template
// had at any point can be read back. Writes go through here only, with the service role, after checking the caller
// is the owner and re-reading the body (parseTemplateBody). Reads of lists go through the signed-in user's session,
// so RLS decides: the owner sees every template, contractors the active ones.
//
// An agreement keeps a snapshot of the template version it was drafted from (agreement-doc TemplateSnapshot), so
// nothing here ever changes an agreement already written.
import { BUILTIN_STANDARD, parseTemplateBody, type TemplateBody, type TemplateSnapshot } from "./agreement-doc";
import { pgAdmin, pgUser } from "./rest";
import { defaultTemplateNameFor } from "./template-seeds";
import type { Session } from "./types";

const UUID_RE = /^[0-9a-fA-F-]{36}$/;

export type DocTemplate = {
  id: string;
  name: string;
  kind: string;
  status: "active" | "archived";
  current_version_id: string | null;
  cloned_from_id: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
};

export type TemplateVersionRow = {
  id: string;
  template_id: string;
  version_no: number;
  body: unknown;
  note: string | null;
  created_by_name: string | null;
  created_at: string;
};

export type TemplateVersionSummary = Omit<TemplateVersionRow, "body" | "template_id">;

const TEMPLATE_COLS = "id,name,kind,status,current_version_id,cloned_from_id,created_by_name,created_at,updated_at";
const VERSION_COLS = "id,version_no,note,created_by_name,created_at";

const isOwner = (s: Session) => s.staff.role === "owner";

/** Templates as the signed-in user may see them: active ones first, then archived (owner only), by name. */
export async function listTemplates(session: Session): Promise<DocTemplate[]> {
  const res = await pgUser(`document_templates?select=${TEMPLATE_COLS}&order=status.asc,name.asc`, session.accessToken);
  return res.ok ? ((await res.json()) as DocTemplate[]) : [];
}

/** Version numbers of the given template versions (for "v3" on the list). */
export async function listTemplateVersionNos(ids: (string | null)[]): Promise<Map<string, number>> {
  const want = ids.filter((x): x is string => Boolean(x && UUID_RE.test(x)));
  if (!want.length) return new Map();
  const res = await pgAdmin(`document_template_versions?id=in.(${want.join(",")})&select=id,version_no`);
  const rows = res.ok ? ((await res.json()) as { id: string; version_no: number }[]) : [];
  return new Map(rows.map((r) => [r.id, r.version_no]));
}

export async function getTemplate(session: Session, id: string): Promise<DocTemplate | null> {
  if (!UUID_RE.test(id)) return null;
  const res = await pgUser(`document_templates?id=eq.${id}&select=${TEMPLATE_COLS}&limit=1`, session.accessToken);
  return res.ok ? (((await res.json()) as DocTemplate[])[0] ?? null) : null;
}

export async function listTemplateVersions(session: Session, templateId: string): Promise<TemplateVersionSummary[]> {
  if (!UUID_RE.test(templateId)) return [];
  const res = await pgUser(`document_template_versions?template_id=eq.${templateId}&select=${VERSION_COLS}&order=version_no.desc`, session.accessToken);
  return res.ok ? ((await res.json()) as TemplateVersionSummary[]) : [];
}

export async function getTemplateVersion(session: Session, versionId: string): Promise<TemplateVersionRow | null> {
  if (!UUID_RE.test(versionId)) return null;
  const res = await pgUser(`document_template_versions?id=eq.${versionId}&select=*&limit=1`, session.accessToken);
  return res.ok ? (((await res.json()) as TemplateVersionRow[])[0] ?? null) : null;
}

/**
 * A template version as an agreement records it. Read with the service role (the caller has already been checked),
 * so a contractor drafting from a template doesn't depend on RLS; `versionNo` null = the template's current version.
 * Archived templates are refused unless a specific version is asked for (re-checking an agreement already drafted).
 */
export async function templateSnapshot(templateId: string, versionNo: number | null = null): Promise<TemplateSnapshot | null> {
  if (!UUID_RE.test(templateId)) return null;
  const tr = await pgAdmin(`document_templates?id=eq.${templateId}&select=${TEMPLATE_COLS}&limit=1`);
  if (!tr.ok) throw new Error(`[templates] couldn't read template (${tr.status})`);
  const t = ((await tr.json()) as DocTemplate[])[0];
  if (!t || (versionNo === null && t.status !== "active")) return null;
  const vq = versionNo === null ? `id=eq.${t.current_version_id}` : `template_id=eq.${templateId}&version_no=eq.${versionNo}`;
  if (versionNo === null && !t.current_version_id) return null;
  const vr = await pgAdmin(`document_template_versions?${vq}&select=*&limit=1`);
  if (!vr.ok) throw new Error(`[templates] couldn't read template version (${vr.status})`);
  const v = ((await vr.json()) as TemplateVersionRow[])[0];
  if (!v || v.template_id !== templateId) return null;
  const body = parseTemplateBody(v.body);
  if (!body.ok) {
    console.error("[templates] stored template body doesn't parse", templateId, v.version_no, body.error);
    return null;
  }
  return { ...body.body, id: t.id, version_no: v.version_no, name: t.name };
}

/** Active templates for the "Write the agreement" picker, and which one is the default for this job. */
export async function templateChoices(service: string | null): Promise<{ choices: { id: string; name: string }[]; defaultId: string | null }> {
  const res = await pgAdmin(`document_templates?status=eq.active&current_version_id=not.is.null&select=id,name&order=name.asc`);
  const choices = res.ok ? ((await res.json()) as { id: string; name: string }[]) : [];
  const want = defaultTemplateNameFor(service);
  return { choices, defaultId: (choices.find((c) => c.name === want) ?? choices.find((c) => c.name === BUILTIN_STANDARD.name) ?? choices[0])?.id ?? null };
}

/** The template a new agreement uses: the one picked (must be active), else the job's default, else the built-in. */
export async function resolveTemplateFor(templateId: string | null, service: string | null): Promise<TemplateSnapshot | { error: string }> {
  if (templateId) return (await templateSnapshot(templateId)) ?? { error: "That template isn't available any more. Pick another." };
  const { defaultId } = await templateChoices(service);
  return (defaultId && (await templateSnapshot(defaultId))) || BUILTIN_STANDARD;
}

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function insertTemplateVersion(templateId: string, body: TemplateBody, note: string | null, who: Session["staff"]) {
  return pgAdmin(`document_template_versions?select=${VERSION_COLS}`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ template_id: templateId, version_no: 1, body, note, created_by: who.id, created_by_name: who.full_name ?? null }),
  });
}

const cleanName = (raw: unknown) => (typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, 120) : "");

/** A new template: from a template body (blank or a copy), with version 1. Owner only. */
export async function createTemplate(
  session: Session,
  input: { name: unknown; body: unknown; clonedFromId: string | null; note: string },
): Promise<Result<{ id: string }>> {
  if (!isOwner(session)) return { ok: false, error: "Only the owner can create templates." };
  const name = cleanName(input.name);
  if (!name) return { ok: false, error: "Give the template a name." };
  const parsed = parseTemplateBody(input.body);
  if (!parsed.ok) return parsed;
  const ins = await pgAdmin(`document_templates?select=id`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      name,
      cloned_from_id: input.clonedFromId && UUID_RE.test(input.clonedFromId) ? input.clonedFromId : null,
      created_by: session.staff.id,
      created_by_name: session.staff.full_name ?? null,
    }),
  });
  const [t] = ins.ok ? ((await ins.json()) as { id: string }[]) : [];
  if (!t) return { ok: false, error: "Couldn't create the template. Try again." };
  const v = await insertTemplateVersion(t.id, parsed.body, input.note.trim().slice(0, 300) || null, session.staff);
  if (!v.ok) {
    console.error("[templates] first version failed", t.id, v.status);
    await pgAdmin(`document_templates?id=eq.${t.id}`, { method: "DELETE" });
    return { ok: false, error: "Couldn't create the template. Try again." };
  }
  return { ok: true, id: t.id };
}

/** Copy a template's current version into a new template, "Copy of <name>". Owner only. */
export async function cloneTemplate(session: Session, templateId: string): Promise<Result<{ id: string }>> {
  if (!isOwner(session)) return { ok: false, error: "Only the owner can copy templates." };
  const src = await getTemplate(session, templateId);
  if (!src?.current_version_id) return { ok: false, error: "That template isn't available." };
  const v = await getTemplateVersion(session, src.current_version_id);
  if (!v) return { ok: false, error: "That template isn't available." };
  return createTemplate(session, { name: `Copy of ${src.name}`, body: v.body, clonedFromId: src.id, note: `Copied from ${src.name} v${v.version_no}` });
}

/** Save a new version of a template. Refused if someone saved a newer one since the editor loaded. Owner only. */
export async function saveTemplateVersion(
  session: Session,
  input: { templateId: string; body: unknown; note: string; baseVersionId: string | null },
): Promise<Result<{ version: TemplateVersionSummary; body: TemplateBody }>> {
  if (!isOwner(session)) return { ok: false, error: "Only the owner can edit templates." };
  const t = await getTemplate(session, input.templateId);
  if (!t) return { ok: false, error: "That template isn't available." };
  if ((t.current_version_id ?? null) !== (input.baseVersionId ?? null)) {
    return { ok: false, error: "This template was saved by someone else meanwhile. Reload to see it; your changes here aren't saved." };
  }
  const parsed = parseTemplateBody(input.body);
  if (!parsed.ok) return parsed;
  const res = await insertTemplateVersion(t.id, parsed.body, input.note.trim().slice(0, 300) || null, session.staff);
  if (!res.ok) {
    console.error("[templates] save failed", t.id, res.status);
    return { ok: false, error: "Couldn't save. Try again." };
  }
  const [version] = (await res.json()) as TemplateVersionSummary[];
  return version ? { ok: true, version, body: parsed.body } : { ok: false, error: "Couldn't save. Try again." };
}

export async function renameTemplate(session: Session, templateId: string, rawName: unknown): Promise<Result> {
  if (!isOwner(session)) return { ok: false, error: "Only the owner can rename templates." };
  const name = cleanName(rawName);
  if (!name || !UUID_RE.test(templateId)) return { ok: false, error: "Give the template a name." };
  const res = await pgAdmin(`document_templates?id=eq.${templateId}&select=id`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ name }) });
  if (!res.ok) return { ok: false, error: "Couldn't rename. Try again." };
  return ((await res.json()) as unknown[]).length === 1 ? { ok: true } : { ok: false, error: "That template isn't available." };
}

/** Archive (hide from new agreements; still readable) or restore. The last active template can't be archived. */
export async function setTemplateStatus(session: Session, templateId: string, status: "active" | "archived"): Promise<Result> {
  if (!isOwner(session)) return { ok: false, error: "Only the owner can archive templates." };
  if (!UUID_RE.test(templateId)) return { ok: false, error: "That template isn't available." };
  if (status === "archived") {
    const others = await pgAdmin(`document_templates?status=eq.active&id=neq.${templateId}&select=id&limit=1`);
    if (!others.ok || ((await others.json()) as unknown[]).length === 0) return { ok: false, error: "Keep at least one active template." };
  }
  const res = await pgAdmin(`document_templates?id=eq.${templateId}&select=id`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ status }) });
  if (!res.ok) return { ok: false, error: "Couldn't update the template. Try again." };
  return ((await res.json()) as unknown[]).length === 1 ? { ok: true } : { ok: false, error: "That template isn't available." };
}
