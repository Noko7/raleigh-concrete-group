import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { getSession } from "@/lib/crm/auth";
import { dict, isLocale } from "@/lib/crm/i18n";
import { crmBase } from "@/lib/crm/nav";
import { flushInBackground } from "@/lib/crm/notify";
import { LogoutButton } from "./logout-button";
import { ForceReset } from "./force-reset";

export const metadata: Metadata = {
  title: { absolute: "CRM | Raleigh Concrete Group" },
  robots: { index: false, follow: false },
};

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const base = await crmBase();

  // Somebody opening the CRM drains the held-message queue, the same way every
  // outbound text already does on its way past.
  //
  // The queue had exactly two timers - the 13:00 and 22:00 UTC crons - and no
  // way of noticing it had stopped. If the morning run does not happen (a
  // rotated CRON_SECRET answers it with a 401, and a 401 looks like nothing at
  // all), a text held until 8am sits there until the evening run, and a text
  // that fails there sits until tomorrow. Meanwhile the office is in the app
  // all morning, which is the one thing we know is happening.
  //
  // Free when there is nothing to do: one indexed SELECT that returns no rows,
  // after() so it is off the response's critical path, and claimMessage means
  // racing a cron or another tab still sends each text once.
  if (session) await flushInBackground();
  const isOwner = session?.staff.role === "owner";
  // Read into a local first: narrowing `session?.staff.locale` doesn't tell
  // TypeScript anything about `session` itself, which may be null here.
  const rawLocale = session?.staff.locale;
  const locale = isLocale(rawLocale) ? rawLocale : "en";
  const t = dict(locale);

  return (
    <div className="crm-shell">
      {session && (
        <header className="crm-topbar">
          <div className="crm-topbar-inner">
            <Link href={`${base}/`} className="crm-logo" aria-label="Raleigh Concrete Group CRM">
              <span className="crm-logo-badge">
                <Image src="/images/logo_horizontal.png" alt="Raleigh Concrete Group" width={967} height={243} priority />
              </span>
              <span className="crm-logo-tag">CRM</span>
            </Link>
            <nav className="crm-nav">
              <Link href={`${base}/`}>{t.nav.pipeline}</Link>
              <Link href={`${base}/calendar`}>{t.nav.calendar}</Link>
              <Link href={`${base}/customers`}>{t.nav.customers}</Link>
              <Link href={`${base}/agreements`}>{t.nav.agreements}</Link>
              {isOwner && <Link href={`${base}/contractors`}>{t.nav.contractors}</Link>}
              {isOwner && <Link href={`${base}/money`}>{t.nav.money}</Link>}
              {isOwner && <Link href={`${base}/archived`}>{t.nav.archived}</Link>}
              {isOwner && <Link href={`${base}/security`}>{t.nav.security}</Link>}
              <Link href={`${base}/settings`}>{t.nav.settings}</Link>
            </nav>
            <div className="crm-topbar-right">
              <span className="crm-who">
                {session.staff.full_name || session.user.email}
                <em>{isOwner ? t.nav.owner : t.nav.contractor}</em>
              </span>
              <LogoutButton base={base} label={t.nav.signOut} />
            </div>
          </div>
        </header>
      )}
      <div className="crm-main">
        {session?.staff.must_reset_password ? <ForceReset locale={locale} /> : children}
      </div>
    </div>
  );
}
