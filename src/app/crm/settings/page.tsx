import { requireSession } from "@/lib/crm/auth";
import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await requireSession();
  const { staff } = session;

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
    </main>
  );
}
