import { Suspense } from "react";

import { requireSession } from "@/lib/crm/auth";
import { readWorkHours } from "@/lib/crm/constants";
import { dict, fill, isLocale } from "@/lib/crm/i18n";
import { ownerRecipientDetails, smsDiagnostics, toE164 } from "@/lib/crm/notify";
import { getPhoneLines, listQuoNumbers } from "@/lib/crm/phone-lines";
import { checkClockDrift } from "@/lib/crm/time-check";
import { getPrimaryContractorId, listContractors, queueHealth } from "@/lib/crm/queries";
import type { Session } from "@/lib/crm/types";
import { ClockCard } from "./clock-card";
import { PhoneLinesForm } from "./phone-lines-form";
import { SettingsForm } from "./settings-form";
import { PrimaryContractorForm } from "./primary-contractor-form";
import { TestSms } from "./test-sms";
import { WorkHoursForm } from "./work-hours-form";

export const dynamic = "force-dynamic";

// (919) 555-1234 from +19195551234.
function pretty(e164: string): string {
  const d = e164.replace(/\D/g, "").slice(-10);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : e164;
}

// The forms render straight away. Anything that reaches outside the database (Quo, the clock check) streams
// in below them, so a slow third party can delay its own card but never the page or a save.
export default async function SettingsPage() {
  const session = await requireSession();
  const { staff } = session;
  const isOwner = staff.role === "owner";
  const locale = isLocale(staff.locale) ? staff.locale : "en";
  const t = dict(locale);

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
        locale={locale}
      />
      {/* Owners get it too: an owner who does estimates is routed like anyone else. */}
      <WorkHoursForm hours={readWorkHours(staff)} locale={locale} />
      {isOwner ? (
        <Suspense fallback={<p className="crm-muted crm-sm">Loading the owner settings…</p>}>
          <OwnerSettings session={session} />
        </Suspense>
      ) : (
        <Suspense fallback={null}>
          <CustomerLine staffId={staff.id} locale={locale} />
        </Suspense>
      )}
    </main>
  );
}

// A contractor's own line, so they know where customers' replies arrive.
async function CustomerLine({ staffId, locale }: { staffId: string; locale: string }) {
  const t = dict(locale).settings;
  const lines = await getPhoneLines().catch(() => null);
  const own = lines?.contractors[staffId];
  return (
    <section className="crm-card crm-settings">
      <h2 className="crm-card-title">{t.lineTitle}</h2>
      <p className="crm-muted crm-sm">{own ? fill(t.lineYours, { number: pretty(own) }) : t.lineNone}</p>
    </section>
  );
}

async function OwnerSettings({ session }: { session: Session }) {
  // All at once: these used to run one after another, so the page waited on their sum.
  const [contractors, primaryId, alertTargets, queue, lines] = await Promise.all([
    listContractors(session),
    getPrimaryContractorId(),
    ownerRecipientDetails(),
    queueHealth(),
    getPhoneLines().catch(() => ({ business: null, contractors: {} })),
  ]);
  const sms = smsDiagnostics();
  const active = contractors.filter((c) => c.active);
  const envFrom = toE164(process.env.QUO_FROM || "");

  return (
    <>
      <PrimaryContractorForm
        contractors={contractors.map((c) => ({ id: c.id, label: c.full_name || c.email || "Contractor" }))}
        current={primaryId}
      />
      {/* Quo and the clock check are outside services: each card waits only for its own. */}
      <Suspense fallback={<p className="crm-muted crm-sm">Loading your Quo numbers…</p>}>
        <PhoneLines
          contractors={active.map((c) => ({ id: c.id, name: c.full_name || c.email || "Contractor" }))}
          business={lines.business}
          lines={lines.contractors}
          envFrom={envFrom ? pretty(envFrom) : null}
        />
      </Suspense>
      <Suspense fallback={<p className="crm-muted crm-sm">Checking the server clock…</p>}>
        <Clock queue={queue} />
      </Suspense>
      <TestSms
        provider={sms.provider}
        from={sms.from}
        missing={sms.missing}
        ready={sms.ready}
        recipients={alertTargets}
      />
    </>
  );
}

async function PhoneLines(props: {
  contractors: { id: string; name: string }[];
  business: string | null;
  lines: Record<string, string>;
  envFrom: string | null;
}) {
  const quo = await listQuoNumbers();
  return (
    <PhoneLinesForm
      {...props}
      numbers={quo.ok ? quo.numbers.map((n) => ({ number: n.number, label: n.label })) : []}
      loadError={quo.ok ? null : quo.error}
    />
  );
}

async function Clock({ queue }: { queue: Awaited<ReturnType<typeof queueHealth>> }) {
  const clock = await checkClockDrift();
  return <ClockCard check={clock} queue={queue} />;
}
