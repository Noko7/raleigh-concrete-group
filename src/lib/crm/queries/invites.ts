// Server-only CRM data access: contractor invites. Re-exported from ../queries.ts.
import { pgUser, pgAdmin } from "../rest";
import type { ContractorInvite, Session } from "../types";

// ── Contractor invites ──────────────────────────────────────────────────────
// The token is a capability (whoever holds it can create one contractor
// account): long, random, single-use, expiring, and every lookup rechecks all three.

export const INVITE_TTL_DAYS = 7;
const INVITE_TOKEN_RE = /^[a-f0-9]{32}$/;

export function newInviteToken(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

export async function createInvite(input: {
  token: string;
  phone: string;
  fullName?: string | null;
  createdBy: string;
}): Promise<boolean> {
  const expires = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const res = await pgAdmin("contractor_invites", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      token: input.token,
      phone: input.phone,
      full_name: input.fullName || null,
      created_by: input.createdBy,
      expires_at: expires,
    }),
  });
  return res.ok;
}

// Service-role (the onboarding page has no session). null for every unusable
// state alike, so callers can't probe which tokens exist.
export async function getUsableInvite(token: string): Promise<ContractorInvite | null> {
  if (!INVITE_TOKEN_RE.test(token)) return null;
  const res = await pgAdmin(`contractor_invites?token=eq.${token}&select=*&limit=1`);
  if (!res.ok) return null;
  const rows = (await res.json()) as ContractorInvite[];
  const invite = rows[0];
  if (!invite) return null;
  if (invite.used_at || invite.revoked_at) return null;
  if (new Date(invite.expires_at).getTime() < Date.now()) return null;
  return invite;
}

// Burn the invite. used_at=is.null makes racing submissions lose: an empty
// result means someone else got there first.
export async function consumeInvite(id: string, staffId: string): Promise<boolean> {
  const res = await pgAdmin(`contractor_invites?id=eq.${encodeURIComponent(id)}&used_at=is.null`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ used_at: new Date().toISOString(), used_by: staffId }),
  });
  if (!res.ok) return false;
  const rows = (await res.json()) as unknown[];
  return rows.length > 0;
}

// Telemetry for the owner; best-effort so it never blocks onboarding.
export async function markInviteOpened(invite: ContractorInvite): Promise<void> {
  await pgAdmin(`contractor_invites?id=eq.${encodeURIComponent(invite.id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      opened_at: invite.opened_at ?? new Date().toISOString(),
      open_count: (invite.open_count ?? 0) + 1,
    }),
  }).catch(() => {});
}

export async function listInvites(session: Session, limit = 50): Promise<ContractorInvite[]> {
  const res = await pgUser(
    `contractor_invites?select=*&order=created_at.desc&limit=${limit}`,
    session.accessToken,
  );
  if (!res.ok) return [];
  return (await res.json()) as ContractorInvite[];
}

export async function revokeInvite(id: string): Promise<boolean> {
  const res = await pgAdmin(`contractor_invites?id=eq.${encodeURIComponent(id)}&used_at=is.null`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ revoked_at: new Date().toISOString() }),
  });
  return res.ok;
}
