import type { Metadata } from "next";
import Image from "next/image";

import { crmBase } from "@/lib/crm/nav";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: { absolute: "CRM Login | Raleigh Concrete Group" },
  robots: { index: false, follow: false },
};

export default async function CrmLoginPage() {
  const base = await crmBase();
  return (
    <main className="crm-auth">
      <div className="crm-auth-card">
        <Image src="/images/logo_horizontal.png" alt="Raleigh Concrete Group" width={967} height={243} className="crm-auth-logo" priority />
        <h1 className="crm-auth-title">Team Login</h1>
        <p className="crm-auth-sub">Sign in to manage quotes, customers and contractors.</p>
        <LoginForm base={base} />
      </div>
    </main>
  );
}
