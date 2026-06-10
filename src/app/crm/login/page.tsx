import type { Metadata } from "next";

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
        <p className="crm-auth-brand">Raleigh Concrete Group</p>
        <h1 className="crm-auth-title">Team Login</h1>
        <p className="crm-auth-sub">Sign in to manage quotes, customers and contractors.</p>
        <LoginForm base={base} />
      </div>
    </main>
  );
}
