"use server";

import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/crm/auth";
import {
  deleteAgreement,
  deleteAgreementFile,
  getAgreement,
  insertAgreement,
  updateAgreement,
} from "@/lib/crm/queries";
import type { AgreementStatus } from "@/lib/crm/types";
import type { AgreementState } from "./types";

const STATUSES: AgreementStatus[] = ["pending", "sent", "signed", "declined", "void"];

// Only ever store a link we recognise as an http(s) URL, so a stored value can't
// turn into a javascript: link when we render it.
function safeUrl(raw: string): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

// Paths we revalidate after a change. The agreement can live on a contractor,
// a job, or the overview, so refresh whichever ones are relevant.
function revalidateFor(quoteId?: string | null) {
  revalidatePath("/crm/agreements");
  revalidatePath("/crm/contractors");
  if (quoteId) revalidatePath(`/crm/quotes/${quoteId}`);
}

export async function createAgreement(_prev: AgreementState, formData: FormData): Promise<AgreementState> {
  const session = await getSession();
  if (!session || session.staff.role !== "owner") return { ok: false, error: "Owners only." };

  const kind = String(formData.get("kind") ?? "");
  const staffId = String(formData.get("staff_id") ?? "").trim();
  const quoteId = String(formData.get("quote_id") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim().slice(0, 160);
  const filePath = String(formData.get("file_path") ?? "").trim() || null;
  const docusealUrl = safeUrl(String(formData.get("docuseal_url") ?? "").trim());
  const notes = String(formData.get("notes") ?? "").trim().slice(0, 2000) || null;
  const status = String(formData.get("status") ?? "pending") as AgreementStatus;

  if (kind !== "contractor" && kind !== "customer") return { ok: false, error: "Unknown agreement type." };
  if (!title) return { ok: false, error: "Give the agreement a title." };
  if (!STATUSES.includes(status)) return { ok: false, error: "Unknown status." };
  if (kind === "contractor" && !staffId) return { ok: false, error: "Missing contractor." };
  if (kind === "customer" && !quoteId) return { ok: false, error: "Missing job." };
  if (!filePath && !docusealUrl) {
    return { ok: false, error: "Attach a file or paste the DocuSeal link." };
  }

  const created = await insertAgreement(session, {
    kind,
    staff_id: kind === "contractor" ? staffId : null,
    quote_id: kind === "customer" ? quoteId : null,
    title,
    status,
    file_path: filePath,
    docuseal_url: docusealUrl,
    notes,
    created_by: session.staff.id,
    // Keep the timestamps consistent with the status they chose on creation.
    sent_at: status === "sent" || status === "signed" ? new Date().toISOString() : null,
    signed_at: status === "signed" ? new Date().toISOString() : null,
  });
  if (!created) return { ok: false, error: "Could not save that agreement." };

  revalidateFor(kind === "customer" ? quoteId : null);
  return { ok: true };
}

export async function setAgreementStatus(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session || session.staff.role !== "owner") return;

  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "") as AgreementStatus;
  if (!id || !STATUSES.includes(status)) return;

  const existing = await getAgreement(session, id);
  if (!existing) return;

  const now = new Date().toISOString();
  await updateAgreement(session, id, {
    status,
    // Stamp the first time it reaches each state; don't overwrite a real date.
    sent_at: existing.sent_at ?? (status === "sent" || status === "signed" ? now : null),
    signed_at: status === "signed" ? existing.signed_at ?? now : existing.signed_at,
  });

  revalidateFor(existing.quote_id);
}

export async function removeAgreement(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session || session.staff.role !== "owner") return;

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  // Read it first so we know which paths to refresh and which file to clean up.
  const existing = await getAgreement(session, id);
  if (!existing) return;

  if (await deleteAgreement(session, id)) {
    if (existing.file_path) await deleteAgreementFile(existing.file_path);
  }

  revalidateFor(existing.quote_id);
}
