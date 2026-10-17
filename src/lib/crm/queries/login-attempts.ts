// Server-only CRM data access: login attempts. Re-exported from ../queries.ts.
import { pgUser, pgAdmin } from "../rest";
import type { LoginAttempt, Session } from "../types";

// ── Login attempts (owner-visible security log) ─────────────────────────────
// Service role: written at login, before any session exists.
export async function logLoginAttempt(input: {
  email: string;
  success: boolean;
  reason: string;
  staffId?: string | null;
  ip: string;
  userAgent: string | null;
}): Promise<void> {
  await pgAdmin("login_attempts", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      email: input.email || null,
      success: input.success,
      reason: input.reason,
      staff_id: input.staffId ?? null,
      ip: input.ip,
      user_agent: input.userAgent,
    }),
  });
}

// Consecutive failed sign-ins for this ACCOUNT since its last success. The
// middleware's IP limiter can't see one password list tried from many
// addresses. A success clears the streak. Service role: no session yet.
export async function recentFailuresFor(email: string, windowMs: number): Promise<number> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return 0;
  const since = new Date(Date.now() - windowMs).toISOString();
  const params = new URLSearchParams({
    select: "success,created_at",
    email: `eq.${normalized}`,
    created_at: `gte.${since}`,
    // Lockout refusals aren't attempts; counting them would let repeated
    // clicks during the cool-off extend it forever.
    reason: "neq.locked_out",
    order: "created_at.desc",
    limit: "40",
  });
  const res = await pgAdmin(`login_attempts?${params.toString()}`);
  // Fail open: this is a throttle, not authorization (the password still has to match).
  if (!res.ok) return 0;
  const rows = (await res.json()) as { success: boolean }[];
  let streak = 0;
  for (const row of rows) {
    if (row.success) break;
    streak += 1;
  }
  return streak;
}

// `since` bounds the window so dashboard stats aren't truncated by the row limit.
export async function listLoginAttempts(
  session: Session,
  limit = 300,
  since?: string,
): Promise<LoginAttempt[]> {
  const params = new URLSearchParams({ select: "*", order: "created_at.desc", limit: String(limit) });
  if (since) params.set("created_at", `gte.${since}`);
  const res = await pgUser(`login_attempts?${params.toString()}`, session.accessToken);
  if (!res.ok) return [];
  return (await res.json()) as LoginAttempt[];
}
