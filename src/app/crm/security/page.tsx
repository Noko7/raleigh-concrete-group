import { requireOwner } from "@/lib/crm/auth";
import { listLoginAttempts } from "@/lib/crm/queries";
import type { LoginAttempt } from "@/lib/crm/types";

export const dynamic = "force-dynamic";

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
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
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

export default async function SecurityPage() {
  const session = await requireOwner();
  const attempts = await listLoginAttempts(session);

  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const last24h = attempts.filter((a) => new Date(a.created_at).getTime() >= dayAgo);
  const failed24h = last24h.filter((a) => !a.success);
  const distinctIps24h = new Set(last24h.map((a) => a.ip || "unknown")).size;
  const flagged = suspiciousIps(attempts);

  return (
    <main className="crm-page crm-page-wide">
      <div className="crm-page-head">
        <div>
          <h1>Security</h1>
          <p className="crm-muted">Every sign-in attempt to your CRM, success or failure, newest first.</p>
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
      </div>

      {flagged.length > 0 && (
        <div className="crm-alert">
          <strong>Possible brute-force activity:</strong>{" "}
          {flagged.map((f) => `${f.ip} (${f.count} failed attempts)`).join(", ")} in the last 24 hours.
        </div>
      )}

      {attempts.length === 0 ? (
        <div className="crm-empty">No login attempts recorded yet.</div>
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
    </main>
  );
}
