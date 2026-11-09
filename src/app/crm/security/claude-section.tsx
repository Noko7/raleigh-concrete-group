import { BUSINESS_TZ } from "@/lib/crm/clock";
import type { ActivityRow, ConnectionRow } from "@/lib/mcp/store";
import { disconnectAllClaude, disconnectClaude, setClaudeConnector } from "./claude-actions";

const KIND_LABELS: Record<string, string> = {
  tool: "Read",
  connect: "Connected",
  deny: "Declined",
  refresh: "Renewed sign-in",
  revoke: "Disconnected",
  register: "App registered",
  refused: "Refused",
};

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: BUSINESS_TZ });
}

function state(c: ConnectionRow): { label: string; tone: string } {
  if (c.revoked_at) return { label: "Disconnected", tone: "crm-badge-lost" };
  if (Date.parse(c.expires_at) <= Date.now()) return { label: "Expired", tone: "crm-badge-lost" };
  return { label: "Active", tone: "crm-badge-success" };
}

// Owner-only (the page checks). The switch, the live connections with a Disconnect each, and every request.
export function ClaudeSection({
  enabled,
  mcpUrl,
  connections,
  activity,
  names,
}: {
  enabled: boolean;
  mcpUrl: string;
  connections: ConnectionRow[];
  activity: ActivityRow[];
  names: Map<string, string>;
}) {
  const live = connections.filter((c) => state(c).label === "Active");
  const reads24h = activity.filter((a) => a.kind === "tool" && Date.parse(a.at) > Date.now() - 86400000).length;
  const refused = activity.filter((a) => !a.ok).length;

  return (
    <section id="claude">
      <h2 className="crm-card-title sec-section-title">Claude connector</h2>
      <div className="crm-card">
        <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <p>
              <span className={`crm-badge ${enabled ? "crm-badge-success" : "crm-badge-lost"}`}>{enabled ? "On" : "Off"}</span>{" "}
              {enabled
                ? "Owners can connect Claude to read the CRM. It can't change anything or send texts."
                : "Nobody can connect Claude, and existing connections can't read anything."}
            </p>
            <p className="crm-muted crm-sm">
              Connector address for claude.ai (Settings → Connectors → Add custom connector) or Claude Code:{" "}
              <code>{mcpUrl}</code>
            </p>
          </div>
          <form action={setClaudeConnector}>
            <input type="hidden" name="on" value={enabled ? "false" : "true"} />
            <button type="submit" className={`crm-btn ${enabled ? "crm-btn-danger" : "crm-btn-primary"}`}>
              {enabled ? "Turn off" : "Turn on"}
            </button>
          </form>
        </div>
      </div>

      <div className="crm-stats">
        <div className="crm-stat">
          <strong>{live.length}</strong>
          <span>Active connections</span>
        </div>
        <div className="crm-stat">
          <strong>{reads24h}</strong>
          <span>Reads, last 24h</span>
        </div>
        <div className="crm-stat">
          <strong>{refused}</strong>
          <span>Refused or failed (recent)</span>
        </div>
      </div>

      <div className="crm-card">
        <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", alignItems: "center" }}>
          <h2 className="crm-card-title">Connections ({connections.length})</h2>
          {live.length > 0 && (
            <form action={disconnectAllClaude}>
              <button type="submit" className="crm-btn crm-btn-danger">
                Disconnect all
              </button>
            </form>
          )}
        </div>
        <p className="crm-muted crm-sm">
          One row per approval. Each lasts up to 90 days, and ends at once if it&apos;s disconnected here, the owner loses
          CRM access, or a stolen sign-in is detected.
        </p>
        {connections.length === 0 ? (
          <p className="crm-muted">Claude hasn&apos;t been connected yet.</p>
        ) : (
          <div className="crm-table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>App</th>
                  <th>Approved by</th>
                  <th>Connected</th>
                  <th>Last used</th>
                  <th>Last IP</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {connections.map((c) => {
                  const s = state(c);
                  return (
                    <tr key={c.id}>
                      <td className="crm-sm">{c.client_name}</td>
                      <td className="crm-sm">{names.get(c.staff_id) ?? "Owner"}</td>
                      <td className="crm-sm">{fmt(c.created_at)}</td>
                      <td className="crm-sm">{c.last_used_at ? fmt(c.last_used_at) : <span className="crm-muted">Not yet</span>}</td>
                      <td className="crm-sm crm-muted">{c.last_ip || "N/A"}</td>
                      <td className="crm-sm">
                        <span className={`crm-badge ${s.tone}`}>{s.label}</span>
                        {c.revoked_reason && <div className="crm-muted crm-sm">{c.revoked_reason}</div>}
                      </td>
                      <td>
                        {s.label === "Active" && (
                          <form action={disconnectClaude}>
                            <input type="hidden" name="grant_id" value={c.id} />
                            <button type="submit" className="crm-btn crm-btn-ghost">
                              Disconnect
                            </button>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="crm-card">
        <h2 className="crm-card-title">Connector activity ({activity.length})</h2>
        <p className="crm-muted crm-sm">Every read Claude made and every sign-in event, newest first. Kept 90 days.</p>
        {activity.length === 0 ? (
          <p className="crm-muted">Nothing yet.</p>
        ) : (
          <div className="crm-table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>What</th>
                  <th>Who</th>
                  <th>Detail</th>
                  <th>Result</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {activity.map((a) => (
                  <tr key={a.id}>
                    <td className="crm-sm">{fmt(a.at)}</td>
                    <td className="crm-sm">
                      {KIND_LABELS[a.kind] ?? a.kind}
                      {a.tool ? `: ${a.tool}` : ""}
                    </td>
                    <td className="crm-sm">
                      {a.staff_id ? (names.get(a.staff_id) ?? "Owner") : "N/A"}
                      {a.client_name && <div className="crm-muted crm-sm">{a.client_name}</div>}
                    </td>
                    <td className="crm-sm crm-muted" style={{ maxWidth: "28rem", overflowWrap: "anywhere" }}>
                      {a.detail || ""}
                    </td>
                    <td>
                      <span className={`crm-badge ${a.ok ? "crm-badge-success" : "crm-badge-danger"}`}>{a.ok ? "OK" : "Refused"}</span>
                    </td>
                    <td className="crm-sm crm-muted">{a.ip || "N/A"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
