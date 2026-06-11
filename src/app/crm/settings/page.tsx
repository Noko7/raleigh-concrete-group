import { requireSession } from "@/lib/crm/auth";
import { getPrimaryContractorId, listContractors } from "@/lib/crm/queries";
import { SettingsForm } from "./settings-form";
import { PrimaryContractorForm } from "./primary-contractor-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await requireSession();
  const { staff } = session;
  const isOwner = staff.role === "owner";

  const contractors = isOwner ? await listContractors(session) : [];
  const primaryId = isOwner ? await getPrimaryContractorId() : null;

  return (
    <main className="crm-page crm-page-narrow">
      <div className="crm-page-head">
        <div>
          <h1>Settings</h1>
          <p className="crm-muted">Update your name and the number we text for job alerts.</p>
        </div>
      </div>
      <SettingsForm
        fullName={staff.full_name ?? ""}
        phone={staff.phone ?? ""}
        email={staff.email ?? session.user.email ?? ""}
        role={staff.role}
      />
      {isOwner && (
        <PrimaryContractorForm
          contractors={contractors.map((c) => ({ id: c.id, label: c.full_name || c.email || "Contractor" }))}
          current={primaryId}
        />
      )}
    </main>
  );
}
