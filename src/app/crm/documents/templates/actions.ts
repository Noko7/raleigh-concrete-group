"use server";

import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/crm/auth";
import { parseTemplateBody, type TemplateBody } from "@/lib/crm/agreement-doc";
import { BLANK_TEMPLATE } from "@/lib/crm/template-tools";
import {
  cloneTemplate,
  createTemplate,
  getTemplate,
  getTemplateVersion,
  renameTemplate,
  saveTemplateVersion,
  setTemplateStatus,
  type TemplateVersionSummary,
} from "@/lib/crm/templates";

// Templates are the owner's: every action here is refused for anyone else (checked again in templates.ts), and the
// database only lets the service role write.

function refresh(templateId?: string) {
  revalidatePath("/crm/documents");
  if (templateId) revalidatePath(`/crm/documents/templates/${templateId}`);
}

type R<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** A new template, blank or copied from the current version of `fromTemplateId`. */
export async function createTemplateAction(name: string, fromTemplateId: string | null): Promise<R<{ id: string }>> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Sign in again." };
  let body: unknown = BLANK_TEMPLATE;
  let note = "Started blank";
  if (fromTemplateId) {
    const src = await getTemplate(session, fromTemplateId);
    const v = src?.current_version_id ? await getTemplateVersion(session, src.current_version_id) : null;
    if (!src || !v) return { ok: false, error: "That template isn't available." };
    body = v.body;
    note = `Started from ${src.name} v${v.version_no}`;
  }
  const r = await createTemplate(session, { name, body, clonedFromId: fromTemplateId, note });
  if (r.ok) refresh(r.id);
  return r;
}

export async function cloneTemplateAction(templateId: string): Promise<R<{ id: string }>> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Sign in again." };
  const r = await cloneTemplate(session, templateId);
  if (r.ok) refresh(r.id);
  return r;
}

export async function saveTemplateAction(
  templateId: string,
  body: TemplateBody,
  note: string,
  baseVersionId: string | null,
): Promise<R<{ version: TemplateVersionSummary; body: TemplateBody }>> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Sign in again." };
  const r = await saveTemplateVersion(session, { templateId, body, note, baseVersionId });
  if (r.ok) refresh(templateId);
  return r;
}

export async function renameTemplateAction(templateId: string, name: string): Promise<R> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Sign in again." };
  const r = await renameTemplate(session, templateId, name);
  if (r.ok) refresh(templateId);
  return r;
}

export async function setTemplateStatusAction(templateId: string, status: "active" | "archived"): Promise<R> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Sign in again." };
  if (status !== "active" && status !== "archived") return { ok: false, error: "Unknown status." };
  const r = await setTemplateStatus(session, templateId, status);
  if (r.ok) refresh(templateId);
  return r;
}

/** One saved template version, for viewing, comparing or restoring. Owner only (RLS also hides archived ones from others). */
export async function getTemplateVersionAction(versionId: string): Promise<R<{ body: TemplateBody; version_no: number }>> {
  const session = await getSession();
  if (!session || session.staff.role !== "owner") return { ok: false, error: "Owners only." };
  const v = await getTemplateVersion(session, versionId);
  const parsed = v ? parseTemplateBody(v.body) : null;
  if (!v || !parsed?.ok) return { ok: false, error: "That version isn't available." };
  return { ok: true, body: parsed.body, version_no: v.version_no };
}
