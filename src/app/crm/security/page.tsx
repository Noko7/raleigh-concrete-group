import Link from "next/link";

import { requireOwner } from "@/lib/crm/auth";
import { BUSINESS_TZ } from "@/lib/crm/clock";
import { eventActor, eventText } from "@/lib/crm/events";
import { crmBase } from "@/lib/crm/nav";
import { getQuoteNames, listLoginAttempts, listRecentActivity, listStaff } from "@/lib/crm/queries";
import type { LoginAttempt, Staff } from "@/lib/crm/types";

export const dynamic = "force-dynamic";

// How far back the dashboard looks. Everything on this page - the stats, the
// per-person table and the attempt log - is bounded by this window.
const WINDOW_DAYS = 30;

const REASON_LABELS: Record<string, string> = {
  ok: "Signed in",
  invalid_format: "Malformed request",
  bad_credentials: "Wrong email or password",
  no_access: "Account not authorized for CRM",
  error: "Server error",
};

function reasonLabel(reason: string): string {
  return REASON_LABELS[reason] ?? reason.replace(/_/g, " ");
}

// Small, dependency-free UA summary - just enough to tell devices apart.
function device(ua: string | null): string {
  if (!ua) return "Unknown";
  const isMobile = /Mobile|Android|iPhone|iPad/i.test(ua);
  let browser = "Browser";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/Chrome\//.test(ua)) browser = "Chrome";
  else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) browser = "Safari";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  return `${browser} · ${isMobile ? "Mobile" : "Desktop"}`;
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: BUSINESS_TZ });
}

function ago(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// Flag any IP with several failed attempts recently - the clearest signal of
// someone (or something) guessing passwords against the CRM login.
function suspiciousIps(attempts: LoginAttempt[]): { ip: string; count: number }[] {
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const counts = new Map<string, number>();
  for (const a of attempts) {
    if (a.success) continue;
    if (new Date(a.created_at).getTime() < dayAgo) continue;
    const ip = a.ip || "unknown";
    counts.set(ip, (counts.get(ip) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 5)
    .map(([ip, count]) => ({ ip, count }))
    .sort((a, b) => b.count - a.count);
}

// An attempt belongs to a person if the login route resolved their staff row.
// Failures never get that far, so fall back to matching the typed email - that's
// what surfaces "someone is failing to log in as this contractor".
function belongsTo(attempt: LoginAttempt, member: Staff): boolean {
  if (attempt.staff_id) return attempt.staff_id === member.id;
  const typed = (attempt.email ?? "").trim().toLowerCase();
  const known = (member.email ?? "").trim().toLowerCase();
  return Boolean(typed && known && typed === known);
}

export default async function SecurityPage() {
  const session = await requireOwner();
  const base = await crmBase();

  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const [attempts, staff, activity] = await Promise.all([
    listLoginAttempts(session, 2000, since),
    listStaff(session),
    listRecentActivity(session, 250),
  ]);
  // The only one that has to wait: it looks up names for the rows above.
  const quoteNames = await getQuoteNames(
    session,
    activity.map((e) => e.quote_id),
  );

  const nameMap = new Map(staff.map((s) => [s.id, s.full_name || s.email || "Staff"]));

  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const last24h = attempts.filter((a) => new Date(a.created_at).getTime() >= dayAgo);
  const failed24h = last24h.filter((a) => !a.success);
  const distinctIps24h = new Set(last24h.map((a) => a.ip || "unknown")).size;
  const flagged = suspiciousIps(attempts);

  // Per-person sign-in summary, contractors first so the crew is easy to scan.
  const people = [...staff]
    .sort((a, b) => (a.role === b.role ? 0 : a.role === "contractor" ? -1 : 1))
    .map((member) => {
      const mine = attempts.filter((a) => belongsTo(a, member));
      const ok = mine.filter((a) => a.success);
      return {
        member,
        signIns: ok.length,
        failed: mine.length - ok.length,
        last: ok[0] ?? null, // attempts come back newest-first
      };
    });

  // Only events a person performed - customer-driven and automatic ones are
  // noise when the question is "what has my crew been doing".
  const staffActivity = activity.filter((e) => e.actor);

  return (
    <main className="crm-page crm-page-wide">
      <div className="crm-page-head">
        <div>
          <h1>Security</h1>
          <p className="crm-muted">
            Sign-ins and team activity across the CRM, last {WINDOW_DAYS} days, newest first.
          </p>
        </div>
      </div>

      <div className="crm-stats">
        <div className="crm-stat">
          <strong>{last24h.length}</strong>
          <span>Attempts, last 24h</span>
        </div>
        <div className="crm-stat">
          <strong>{failed24h.length}</strong>
          <span>Failed, last 24h</span>
        </div>
        <div className="crm-stat">
          <strong>{distinctIps24h}</strong>
          <span>Distinct IPs, last 24h</span>
        </div>
        <div className="crm-stat">
          <strong>{staffActivity.length}</strong>
          <span>Team actions logged</span>
        </div>
      </div>

      {flagged.length > 0 && (
        <div className="crm-alert">
          <strong>Possible brute-force activity:</strong>{" "}
          {flagged.map((f) => `${f.ip} (${f.count} failed attempts)`).join(", ")} in the last 24 hours.
        </div>
      )}

      <div className="crm-card">
        <h2 className="crm-card-title">Who signed in ({people.length})</h2>
        <p className="crm-muted crm-sm">
          One row per account. Failed attempts are matched on the email typed at the login screen, so a stranger
          guessing a contractor&apos;s password shows up on their row.
        </p>
        <div className="crm-table-wrap">
          <table className="crm-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Last sign-in</th>
                <th>Sign-ins</th>
                <th>Failed</th>
                <th>Last device</th>
                <th>Last IP</th>
              </tr>
            </thead>
            <tbody>
              {people.map(({ member, signIns, failed, last }) => (
                <tr key={member.id}>
                  <td>
                    {member.full_name || member.email || "Staff"}
                    {!member.active && <span className="crm-badge crm-badge-lost sec-inline-badge">Inactive</span>}
                  </td>
                  <td>
                    <span className={`crm-badge crm-badge-${member.role === "owner" ? "owner" : "contractor"}`}>
                      {member.role === "owner" ? "Owner" : "Contractor"}
                    </span>
                  </td>
                  <td className="crm-sm">
                    {last ? (
                      <>
                        {fmt(last.created_at)} <span className="crm-muted">· {ago(last.created_at)}</span>
                      </>
                    ) : (
                      <span className="crm-muted">Never in this window</span>
                    )}
                  </td>
                  <td>{signIns}</td>
                  <td className={failed > 0 ? "sec-failed" : undefined}>{failed}</td>
                  <td className="crm-sm crm-muted">{last ? device(last.user_agent) : "N/A"}</td>
                  <td className="crm-sm crm-muted">{last?.ip || "N/A"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="crm-card">
        <h2 className="crm-card-title">Team activity ({staffActivity.length})</h2>
        <p className="crm-muted crm-sm">
          Everything your crew changed in the CRM, newest first. Customer-driven and automatic events are left out —
          those show on each job&apos;s own timeline.
        </p>
        {staffActivity.length === 0 ? (
          <p className="crm-muted">No team activity recorded yet.</p>
        ) : (
          <div className="crm-table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>What</th>
                  <th>Job</th>
                </tr>
              </thead>
              <tbody>
                {staffActivity.map((e) => (
                  <tr key={e.id}>
                    <td className="crm-sm">
                      {fmt(e.created_at)} <span className="crm-muted">· {ago(e.created_at)}</span>
                    </td>
                    <td className="crm-sm">{eventActor(e, nameMap)}</td>
                    <td className="crm-sm">{eventText(e, nameMap)}</td>
                    <td className="crm-sm">
                      <Link href={`${base}/quotes/${e.quote_id}`} className="crm-link-strong">
                        {quoteNames.get(e.quote_id) ?? "View job"}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="crm-card">
        <h2 className="crm-card-title">Every sign-in attempt ({attempts.length})</h2>
        {attempts.length === 0 ? (
          <p className="crm-muted">No login attempts recorded in the last {WINDOW_DAYS} days.</p>
        ) : (
          <div className="crm-table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Email</th>
                  <th>Result</th>
                  <th>Reason</th>
                  <th>IP</th>
                  <th>Device</th>
                </tr>
              </thead>
              <tbody>
                {attempts.map((a) => (
                  <tr key={a.id}>
                    <td className="crm-sm">{fmt(a.created_at)}</td>
                    <td className="crm-sm">{a.email || "N/A"}</td>
                    <td>
                      <span className={`crm-badge ${a.success ? "crm-badge-success" : "crm-badge-danger"}`}>
                        {a.success ? "Success" : "Failed"}
                      </span>
                    </td>
                    <td className="crm-sm">{reasonLabel(a.reason)}</td>
                    <td className="crm-sm">{a.ip || "N/A"}</td>
                    <td className="crm-sm crm-muted">{device(a.user_agent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
