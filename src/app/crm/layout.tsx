import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { getSession } from "@/lib/crm/auth";
import { dict, isLocale } from "@/lib/crm/i18n";
import { crmBase } from "@/lib/crm/nav";
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
            {/* Same nine destinations, same labels, same order - this is
                muscle memory for the two people who live in it. The list is
                built here rather than in the client component so the owner-only
                items never reach a contractor's browser at all. */}
            <CrmNav
              base={base}
              items={[
                // A quote detail page is somewhere you got to FROM the
                // pipeline, so that is what stays lit while you are on it.
                { href: "/", label: t.nav.pipeline, also: ["/quotes"] },
                { href: "/calendar", label: t.nav.calendar },
                { href: "/customers", label: t.nav.customers },
                { href: "/agreements", label: t.nav.agreements },
                ...(isOwner
                  ? [
                      { href: "/contractors", label: t.nav.contractors, owner: true },
                      { href: "/money", label: t.nav.money, owner: true },
                      { href: "/archived", label: t.nav.archived, owner: true },
                      { href: "/security", label: t.nav.security, owner: true },
                    ]
                  : []),
                { href: "/settings", label: t.nav.settings },
              ]}
            />
            <div className="crm-topbar-right">
              <span className="crm-who">
                <span className="crm-who-name">{session.staff.full_name || session.user.email}</span>
                {/* Was amber, the same colour the nav now uses for "you are
                    here". One accent, one meaning: a role that never changes
                    does not need the loudest colour on the bar. */}
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
