// Server-only CRM data access: agreements. Re-exported from ../queries.ts.
import { SUPABASE_URL, SERVICE_KEY, AGREEMENT_BUCKET } from "../env";
import { pgUser } from "../rest";
import type { Agreement, Session } from "../types";

// ── Agreements (contracts sent for signature through DocuSeal) ──────────────
// pgUser so RLS authorizes: owners see all; contractors their own onboarding
// doc and agreements for their assigned jobs.

export async function listAgreementsForQuote(session: Session, quoteId: string): Promise<Agreement[]> {
  const res = await pgUser(
    `agreements?quote_id=eq.${encodeURIComponent(quoteId)}&select=*&order=created_at.desc`,
    session.accessToken,
  );
  if (!res.ok) return [];
  return (await res.json()) as Agreement[];
}

export async function listAgreementsForStaff(session: Session, staffId: string): Promise<Agreement[]> {
  const res = await pgUser(
    `agreements?staff_id=eq.${encodeURIComponent(staffId)}&select=*&order=created_at.desc`,
    session.accessToken,
  );
  if (!res.ok) return [];
  return (await res.json()) as Agreement[];
}

export async function listAllAgreements(session: Session): Promise<Agreement[]> {
  const res = await pgUser("agreements?select=*&order=created_at.desc", session.accessToken);
  if (!res.ok) return [];
  return (await res.json()) as Agreement[];
}

export async function getAgreement(session: Session, id: string): Promise<Agreement | null> {
  const res = await pgUser(
    `agreements?id=eq.${encodeURIComponent(id)}&select=*&limit=1`,
    session.accessToken,
  );
  if (!res.ok) return null;
  const rows = (await res.json()) as Agreement[];
  return rows[0] ?? null;
}

export async function insertAgreement(session: Session, row: Partial<Agreement>): Promise<Agreement | null> {
  const res = await pgUser("agreements", session.accessToken, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  if (!res.ok) return null;
  const rows = (await res.json()) as Agreement[];
  return rows[0] ?? null;
}

export async function updateAgreement(
  session: Session,
  id: string,
  patch: Partial<Agreement>,
): Promise<boolean> {
  const res = await pgUser(`agreements?id=eq.${encodeURIComponent(id)}`, session.accessToken, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });
  return res.ok;
}

export async function deleteAgreement(session: Session, id: string): Promise<boolean> {
  const res = await pgUser(`agreements?id=eq.${encodeURIComponent(id)}`, session.accessToken, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
  return res.ok;
}

// Best-effort: the row is the source of truth; an orphaned object is harmless.
export async function deleteAgreementFile(path: string): Promise<void> {
  const prefix = `${AGREEMENT_BUCKET}/`;
  const obj = path.startsWith(prefix) ? path.slice(prefix.length) : path;
  if (!obj || obj.includes("..") || obj.startsWith("/")) return;
  await fetch(`${SUPABASE_URL}/storage/v1/object/${AGREEMENT_BUCKET}/${obj}`, {
    method: "DELETE",
    cache: "no-store",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  }).catch(() => {});
}
