import { requireOwner } from "@/lib/crm/auth";
import { listStaff } from "@/lib/crm/queries";
import { AddContractor } from "./add-contractor";
import { ResetPassword } from "./reset-password";
import { setContractorActive } from "./actions";

export const dynamic = "force-dynamic";

export default async function ContractorsPage() {
  const session = await requireOwner();
  const staff = await listStaff(session);
  const contractors = staff.filter((s) => s.role === "contractor");

  return (
    <main className="crm-page">
      <div className="crm-page-head">
        <h1>Contractors</h1>
        <p className="crm-muted">Create logins for your crew and assign them jobs. They only see jobs assigned to them.</p>
      </div>

      <AddContractor />

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
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {contractors.map((c) => (
                  <tr key={c.id}>
                    <td>{c.full_name || "N/A"}</td>
                    <td>{c.email}</td>
                    <td>{c.phone || "N/A"}</td>
                    <td>
                      {c.active ? (
                        <span className="crm-badge crm-badge-won">Active</span>
                      ) : (
                        <span className="crm-badge crm-badge-lost">Inactive</span>
                      )}
                    </td>
                    <td className="crm-row-actions">
                      <form action={setContractorActive}>
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="active" value={(!c.active).toString()} />
                        <button type="submit" className="crm-btn crm-btn-ghost">
                          {c.active ? "Deactivate" : "Reactivate"}
                        </button>
                      </form>
                      <ResetPassword id={c.id} name={c.full_name || c.email || "this contractor"} />
                    </td>
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
