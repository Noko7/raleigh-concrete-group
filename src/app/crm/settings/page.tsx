import { requireSession } from "@/lib/crm/auth";
import { dict, isLocale } from "@/lib/crm/i18n";
import { ownerRecipientDetails, smsDiagnostics } from "@/lib/crm/notify";
import { checkClockDrift } from "@/lib/crm/time-check";
import { getPrimaryContractorId, listContractors } from "@/lib/crm/queries";
import { ClockCard } from "./clock-card";
import { SettingsForm } from "./settings-form";
import { PrimaryContractorForm } from "./primary-contractor-form";
import { TestSms } from "./test-sms";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await requireSession();
  const { staff } = session;
  const isOwner = staff.role === "owner";

  const contractors = isOwner ? await listContractors(session) : [];
  const primaryId = isOwner ? await getPrimaryContractorId() : null;
  const sms = isOwner ? smsDiagnostics() : null;
  const alertTargets = isOwner ? await ownerRecipientDetails() : [];
  // One HEAD request to a public host, only when an owner opens this page.
  // Nothing else in the app waits on it.
  const clock = isOwner ? await checkClockDrift() : null;
  const t = dict(staff.locale);

  return (
    <main className="crm-page crm-page-narrow">
      <div className="crm-page-head">
        <div>
          <h1>{t.settings.title}</h1>
          <p className="crm-muted">{t.settings.subtitle}</p>
        </div>
      </div>
      <SettingsForm
        fullName={staff.full_name ?? ""}
        phone={staff.phone ?? ""}
        email={staff.email ?? session.user.email ?? ""}
        role={staff.role}
        locale={isLocale(staff.locale) ? staff.locale : "en"}
      />
      {isOwner && (
        <PrimaryContractorForm
          contractors={contractors.map((c) => ({ id: c.id, label: c.full_name || c.email || "Contractor" }))}
          current={primaryId}
        />
      )}
      {isOwner && clock && <ClockCard check={clock} />}
      {isOwner && sms && (
        <TestSms
          provider={sms.provider}
          from={sms.from}
          missing={sms.missing}
          ready={sms.ready}
          recipients={alertTargets}
        />
      )}
    </main>
  );
}
