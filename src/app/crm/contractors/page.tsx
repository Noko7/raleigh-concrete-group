import { requireOwner } from "@/lib/crm/auth";
import { listAllAgreements, listInvites, listStaff } from "@/lib/crm/queries";
import { AddAgreement } from "../agreements/add-agreement";
import { AgreementList, AgreementStatusBadge } from "../agreements/agreement-list";
import { AddContractor } from "./add-contractor";
import { DeleteContractor } from "./delete-contractor";
import { EditContact } from "./edit-contact";
import { InviteContractor } from "./invite-contractor";
import { ResetPassword } from "./reset-password";
import { revokeContractorInvite, setContractorActive } from "./actions";

export const dynamic = "force-dynamic";

// Numbers are stored E.164 (+19198733919) so the SMS providers accept them;
// show them the way you'd read them out loud.
function prettyPhone(raw: string | null): string {
  if (!raw) return "N/A";
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(raw.trim());
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : raw;
}

export default async function ContractorsPage() {
  const session = await requireOwner();
  // The crew list, the invites and the signed agreements are three unrelated
  // tables; fetch them together rather than three round-trips deep.
  const [staff, rawInvites, allAgreements] = await Promise.all([
    listStaff(session),
    listInvites(session),
    listAllAgreements(session),
  ]);
  const contractors = staff.filter((s) => s.role === "contractor");

  // Every invite with where it actually got to, so an unfinished signup is
  // visible instead of just silently missing from the crew list.
  const now = Date.now();
  const invites = rawInvites.map((i) => {
    const expired = new Date(i.expires_at).getTime() <= now;
    const state: "completed" | "cancelled" | "expired" | "started" | "sent" = i.used_at
      ? "completed"
      : i.revoked_at
        ? "cancelled"
        : expired
          ? "expired"
          : i.opened_at
            ? "started"
            : "sent";
    return { ...i, state };
  });
  // Anything still actionable stays at the top; finished/dead ones drop below.
  const liveInvites = invites.filter((i) => i.state === "sent" || i.state === "started");
  const doneInvites = invites.filter((i) => i.state !== "sent" && i.state !== "started").slice(0, 15);

  const INVITE_STATE: Record<string, { label: string; cls: string }> = {
    sent: { label: "Sent, not opened", cls: "ag-badge-pending" },
    started: { label: "Opened, not finished", cls: "ag-badge-sent" },
    completed: { label: "Account created", cls: "ag-badge-signed" },
    cancelled: { label: "Cancelled", cls: "ag-badge-void" },
    expired: { label: "Expired", cls: "ag-badge-void" },
  };

  // One fetch for the whole page (batched above), then bucket by contractor.
  const byStaff = new Map<string, typeof allAgreements>();
  for (const a of allAgreements) {
    if (a.kind !== "contractor" || !a.staff_id) continue;
    const list = byStaff.get(a.staff_id) ?? [];
    list.push(a);
    byStaff.set(a.staff_id, list);
  }

  return (
    <main className="crm-page">
      <div className="crm-page-head">
        <h1>Contractors</h1>
        <p className="crm-muted">Create logins for your crew and assign them jobs. They only see jobs assigned to them.</p>
      </div>

      <InviteContractor />

      {(liveInvites.length > 0 || doneInvites.length > 0) && (
        <div className="crm-card">
          <h2 className="crm-card-title">Signups ({liveInvites.length} in progress)</h2>
          <p className="crm-muted crm-sm">
            Where each invite got to. <strong>Opened, not finished</strong> means they tapped the link but never
            created the account — worth a call. Cancelling stops a link working immediately.
          </p>
          <div className="crm-table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Sent to</th>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Opened</th>
                  <th>Expires</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {[...liveInvites, ...doneInvites].map((i) => {
                  const s = INVITE_STATE[i.state];
                  return (
                    <tr key={i.id}>
                      <td>{prettyPhone(i.phone)}</td>
                      <td>{i.full_name || <span className="crm-muted">—</span>}</td>
                      <td>
                        <span className={`crm-badge ${s.cls}`}>{s.label}</span>
                      </td>
                      <td className="crm-sm">
                        {i.opened_at ? (
                          <>
                            {new Date(i.opened_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                            {i.open_count > 1 && <span className="crm-muted"> ·{i.open_count}×</span>}
                          </>
                        ) : (
                          <span className="crm-muted">—</span>
                        )}
                      </td>
                      <td className="crm-sm">
                        {new Date(i.expires_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </td>
                      <td className="crm-row-actions">
                        {(i.state === "sent" || i.state === "started") && (
                          <form action={revokeContractorInvite}>
                            <input type="hidden" name="id" value={i.id} />
                            <button type="submit" className="crm-btn crm-btn-ghost">
                              Cancel
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
        </div>
      )}

      <details className="crm-manual-add">
        <summary>Or add a contractor manually</summary>
        <AddContractor />
      </details>

      <div className="crm-card">
        <h2 className="crm-card-title">Your crew ({contractors.length})</h2>
        {contractors.length === 0 ? (
          <p className="crm-muted">No contractors yet. Add one above.</p>
        ) : (
          <div className="crm-table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Job types</th>
                  <th>Status</th>
                  <th>Agreement</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {contractors.map((c) => (
                  <tr key={c.id}>
                    <td>{c.full_name || "N/A"}</td>
                    <td>{c.email}</td>
                    <td>{prettyPhone(c.phone)}</td>
                    <td>
                      {/* "Anything" is the honest label for no rules set: the
                          lead still reaches them via the primary-contractor
                          fallback, so an empty list is not "nothing". */}
                      {c.service_types?.length ? (
                        <span className="crm-sm">{c.service_types.join(", ")}</span>
                      ) : (
                        <span className="crm-muted crm-sm">Anything</span>
                      )}
                    </td>
                    <td>
                      {c.active ? (
                        <span className="crm-badge crm-badge-won">Active</span>
                      ) : (
                        <span className="crm-badge crm-badge-lost">Inactive</span>
                      )}
                    </td>
                    <td>
                      {(() => {
                        const list = byStaff.get(c.id) ?? [];
                        // Show the signed one if there is one, otherwise the most recent.
                        const headline = list.find((a) => a.status === "signed") ?? list[0];
                        return headline ? (
                          <AgreementStatusBadge status={headline.status} />
                        ) : (
                          <span className="crm-muted crm-sm">None</span>
                        );
                      })()}
                    </td>
                    <td className="crm-row-actions">
                      <form action={setContractorActive}>
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="active" value={(!c.active).toString()} />
                        <button type="submit" className="crm-btn crm-btn-ghost">
                          {c.active ? "Deactivate" : "Reactivate"}
                        </button>
                      </form>
                      <EditContact
                        id={c.id}
                        name={c.full_name ?? ""}
                        email={c.email ?? ""}
                        phone={c.phone}
                        serviceTypes={c.service_types ?? []}
                      />
                      <ResetPassword id={c.id} name={c.full_name || c.email || "this contractor"} />
                      <DeleteContractor id={c.id} name={c.full_name || c.email || "Contractor"} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {contractors.length > 0 && (
        <div className="crm-card">
          <h2 className="crm-card-title">Onboarding agreements</h2>
          <p className="crm-muted crm-sm">
            One signed agreement per crew member. Send it from DocuSeal, then record it here so you can see at a glance
            who is covered. Contractors can view their own agreement in the CRM but can&apos;t change its status.
          </p>
          <div className="ag-groups">
            {contractors.map((c) => (
              <div key={c.id} className="ag-group">
                <div className="ag-group-head">
                  <strong>{c.full_name || c.email || "Contractor"}</strong>
                </div>
                <AgreementList agreements={byStaff.get(c.id) ?? []} isOwner />
                <div className="ag-add">
                  <AddAgreement
                    kind="contractor"
                    targetId={c.id}
                    defaultTitle={`Contractor agreement — ${c.full_name || c.email || "Contractor"}`}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
