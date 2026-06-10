import type { Metadata } from "next";
import Link from "next/link";

import { getSession } from "@/lib/crm/auth";
import { crmBase } from "@/lib/crm/nav";
import { LogoutButton } from "./logout-button";

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
            <Link href={`${base}/`} className="crm-logo">
              RCG <span>CRM</span>
            </Link>
            <nav className="crm-nav">
              <Link href={`${base}/`}>Quotes</Link>
              <Link href={`${base}/customers`}>Customers</Link>
              {isOwner && <Link href={`${base}/contractors`}>Contractors</Link>}
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
      <div className="crm-main">{children}</div>
    </div>
  );
}
