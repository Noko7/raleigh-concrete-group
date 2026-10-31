import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { getSession } from "@/lib/crm/auth";
import { dict, isLocale } from "@/lib/crm/i18n";
import { crmBase } from "@/lib/crm/nav";
import { flushInBackground } from "@/lib/crm/notify";
import { CrmNav } from "./crm-nav";
import { LogoutButton } from "./logout-button";
import { ForceReset } from "./force-reset";

export const metadata: Metadata = {
  title: { absolute: "CRM | Raleigh Concrete Group" },
  robots: { index: false, follow: false },
};

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const base = await crmBase();

  // Opening the CRM also drains the held-message queue, a backstop for the 13:00/22:00 UTC crons failing
  // silently (e.g. a rotated CRON_SECRET 401s). Free when empty (one indexed SELECT, in after()); claimMessage
  // keeps each text single-send when racing a cron or another tab.
  if (session) await flushInBackground();
  const isOwner = session?.staff.role === "owner";
  // Narrowing `session?.staff.locale` doesn't narrow `session` itself.
  const rawLocale = session?.staff.locale;
  const locale = isLocale(rawLocale) ? rawLocale : "en";
  const t = dict(locale);

  return (
    <div className="crm-shell">
      {session && (
        <header className="crm-topbar">
          <div className="crm-topbar-inner">
            {/*
              Built here, not in the client component, so owner-only items never reach a contractor's browser.
              Labels and order are muscle memory: don't reshuffle.
            */}
            <CrmNav
              base={base}
              items={[
                // Quote detail pages are reached from the pipeline, so it stays lit.
                { href: "/", label: t.nav.pipeline, also: ["/quotes"] },
                { href: "/calendar", label: t.nav.calendar },
                { href: "/customers", label: t.nav.customers },
                { href: "/documents", label: t.nav.documents, also: ["/agreements"] },
                // A contractor's Money page shows only their jobs, so it sits with the shared items.
                ...(isOwner ? [] : [{ href: "/money", label: t.nav.money }]),
                ...(isOwner
                  ? [
                      { href: "/contractors", label: t.nav.contractors, owner: true },
                      { href: "/money", label: t.nav.money, owner: true },
                      { href: "/archived", label: t.nav.archived, owner: true },
                      { href: "/funnel", label: t.nav.funnel, owner: true },
                      { href: "/security", label: t.nav.security, owner: true },
                    ]
                  : []),
                { href: "/settings", label: t.nav.settings },
              ]}
            />
            <Link href={`${base}/`} className="crm-logo" aria-label="Raleigh Concrete Group CRM">
              <span className="crm-logo-badge">
                <Image src="/images/logo_horizontal.png" alt="Raleigh Concrete Group" width={967} height={243} priority />
              </span>
              <span className="crm-logo-tag">CRM</span>
            </Link>
            <div className="crm-topbar-right">
              <span className="crm-who">
                <span className="crm-who-name">{session.staff.full_name || session.user.email}</span>
                {/* Not amber: that accent means "you are here". */}
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
