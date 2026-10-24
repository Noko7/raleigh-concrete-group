// Server-only CRM data access: staff, contractors, owner settings and lead routing. Re-exported from ../queries.ts.
import { pgUser, pgAdmin } from "../rest";
import type { Session, Staff } from "../types";

// id → display name for showing assignees without a PostgREST join.
export function staffNameMap(staff: Staff[]): Map<string, string> {
  return new Map(staff.map((s) => [s.id, s.full_name || s.email || "Staff"]));
}

export async function listStaff(session: Session): Promise<Staff[]> {
  const res = await pgUser("staff?select=*&order=created_at.asc", session.accessToken);
  if (!res.ok) return [];
  return (await res.json()) as Staff[];
}

export async function listContractors(session: Session): Promise<Staff[]> {
  const all = await listStaff(session);
  return all.filter((s) => s.role === "contractor");
}

export async function getStaffById(session: Session, id: string): Promise<Staff | null> {
  const res = await pgUser(`staff?id=eq.${encodeURIComponent(id)}&select=*&limit=1`, session.accessToken);
  if (!res.ok) return null;
  const rows = (await res.json()) as Staff[];
  return rows[0] ?? null;
}

// Service role so a contractor can edit their own row; restricted to their id
// and to name/phone/locale/hours. Never role or active.
export async function updateOwnProfile(
  session: Session,
  patch: {
    full_name?: string | null;
    phone?: string | null;
    locale?: string;
    work_start_hour?: number;
    work_end_hour?: number;
    work_days?: number[];
  },
): Promise<boolean> {
  const body: Record<string, unknown> = {};
  if (patch.full_name !== undefined) body.full_name = patch.full_name;
  if (patch.phone !== undefined) body.phone = patch.phone;
  if (patch.locale !== undefined) body.locale = patch.locale;
  if (patch.work_start_hour !== undefined) body.work_start_hour = patch.work_start_hour;
  if (patch.work_end_hour !== undefined) body.work_end_hour = patch.work_end_hour;
  if (patch.work_days !== undefined) body.work_days = patch.work_days;
  if (Object.keys(body).length === 0) return true;
  const res = await pgAdmin(`staff?id=eq.${encodeURIComponent(session.staff.id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  return res.ok;
}

// Every active owner gets all notifications. Service role: /api/quote has no session.
export async function getOwnerPhones(): Promise<string[]> {
  return (await getOwnerContacts()).map((o) => o.phone);
}

// With names, so Settings can say whose number is whose.
export async function getOwnerContacts(): Promise<{ name: string; phone: string }[]> {
  const res = await pgAdmin("staff?role=eq.owner&active=eq.true&select=full_name,email,phone");
  if (!res.ok) return [];
  const rows = (await res.json()) as { full_name: string | null; email: string | null; phone: string | null }[];
  return rows
    .filter((r) => typeof r.phone === "string" && r.phone.trim() !== "")
    .map((r) => ({ name: r.full_name || r.email || "Owner", phone: r.phone as string }));
}

// Service-role, for token-gated code with no session.
export async function getStaffPhoneById(id: string): Promise<string | null> {
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) return null;
  const res = await pgAdmin(`staff?id=eq.${id}&select=phone&limit=1`);
  if (!res.ok) return null;
  const rows = (await res.json()) as { phone: string | null }[];
  return rows[0]?.phone ?? null;
}

// ── Owner settings (app_integrations, provider='settings') ──────────────────
// Holds the primary contractor new quotes fall back to.
// One "settings" row in app_integrations holds the owner's app-wide choices as JSON (primary contractor,
// phone lines). Writes merge into it, so saving one setting never wipes another.
export async function readAppSettings(): Promise<Record<string, unknown>> {
  const res = await pgAdmin("app_integrations?provider=eq.settings&select=data&limit=1");
  if (!res.ok) throw new Error(`Could not read app settings (HTTP ${res.status}).`);
  const rows = (await res.json()) as { data: Record<string, unknown> | null }[];
  return rows[0]?.data ?? {};
}

export async function writeAppSettings(patch: Record<string, unknown>): Promise<boolean> {
  let current: Record<string, unknown>;
  try {
    current = await readAppSettings();
  } catch {
    // Writing blind would replace every other setting with just this one.
    return false;
  }
  const res = await pgAdmin("app_integrations", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      provider: "settings",
      data: { ...current, ...patch },
      updated_at: new Date().toISOString(),
    }),
  });
  return res.ok;
}

export async function getPrimaryContractorId(): Promise<string | null> {
  const data = await readAppSettings().catch(() => ({}) as Record<string, unknown>);
  const id = data.primary_contractor_id;
  return typeof id === "string" && id ? id : null;
}

export async function setPrimaryContractorId(id: string | null): Promise<boolean> {
  return writeAppSettings({ primary_contractor_id: id });
}

// ── Routing a lead to the right contractor ──────────────────────────────────
// A lead goes to the first active contractor whose service_types include its
// service, else the primary contractor. `service` is free text (the CRM form
// and endpoint accept anything), so matching ignores case and spaces.
const normalizeService = (s?: string | null) => (s ?? "").trim().toLowerCase();

export async function listActiveContractors(): Promise<Staff[]> {
  const res = await pgAdmin("staff?role=eq.contractor&active=eq.true&select=*&order=created_at.asc");
  if (!res.ok) return [];
  return (await res.json()) as Staff[];
}

// null only when there's no primary contractor either; the lead stays
// unassigned and the owner still gets the alert.
export async function resolveAssignee(service?: string | null): Promise<string | null> {
  const wanted = normalizeService(service);

  if (wanted) {
    // created_at order: the longer-standing contractor wins ties, predictably.
    const contractors = await listActiveContractors();
    const match = contractors.find((c) =>
      (c.service_types ?? []).some((t) => normalizeService(t) === wanted),
    );
    if (match) return match.id;
  }

  return getPrimaryContractorId();
}

// Service-role (no session), for the public submission endpoint.
export async function getStaffContactById(
  id: string,
): Promise<{ phone: string | null; email: string | null; full_name: string | null } | null> {
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) return null;
  const res = await pgAdmin(`staff?id=eq.${id}&active=eq.true&select=phone,email,full_name&limit=1`);
  if (!res.ok) return null;
  const rows = (await res.json()) as { phone: string | null; email: string | null; full_name: string | null }[];
  return rows[0] ?? null;
}

export async function updateStaff(session: Session, id: string, patch: Partial<Staff>): Promise<boolean> {
  const res = await pgUser(`staff?id=eq.${encodeURIComponent(id)}`, session.accessToken, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });
  return res.ok;
}

export async function insertStaff(session: Session, row: Partial<Staff>): Promise<boolean> {
  const res = await pgUser("staff", session.accessToken, {
    method: "POST",
    headers: { Prefer: "return=minimal,resolution=merge-duplicates" },
    body: JSON.stringify(row),
  });
  return res.ok;
}
