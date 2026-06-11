import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { getSession } from "@/lib/crm/auth";
import { crmBase } from "@/lib/crm/nav";
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
              <Link href={`${base}/`}>Pipeline</Link>
              <Link href={`${base}/calendar`}>Calendar</Link>
              <Link href={`${base}/customers`}>Customers</Link>
              <Link href={`${base}/calculator`}>Calculator</Link>
              {isOwner && <Link href={`${base}/contractors`}>Contractors</Link>}
              <Link href={`${base}/settings`}>Settings</Link>
            </nav>
            <div className="crm-topbar-right">
              <span className="crm-who">
                {session.staff.full_name || session.user.email}
                <em>{session.staff.role}</em>
              </span>
              <LogoutButton base={base} />
            </div>
          </div>
        </header>
      )}
      <div className="crm-main">
        {session?.staff.must_reset_password ? <ForceReset /> : children}
      </div>
    </div>
  );
}
