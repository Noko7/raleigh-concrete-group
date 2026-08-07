import type { Metadata } from "next";
import Image from "next/image";

import { crmBase } from "@/lib/crm/nav";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: { absolute: "CRM Login | Raleigh Concrete Group" },
  robots: { index: false, follow: false },
};

// Only accept a same-site relative path (e.g. "/job/abc123") so this can't be
// abused as an open redirect via an absolute or protocol-relative URL.
function safeNext(next: string | undefined): string | undefined {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return undefined;
  return next;
}

export default async function CrmLoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const base = await crmBase();
  const next = safeNext((await searchParams).next);
  return (
    <main className="crm-auth">
      <div className="crm-auth-card">
        <Image src="/images/logo_horizontal.png" alt="Raleigh Concrete Group" width={967} height={243} className="crm-auth-logo" priority />
        <h1 className="crm-auth-title">Team Login</h1>
        <p className="crm-auth-sub">Sign in to manage quotes, customers and contractors.</p>
        <LoginForm base={base} next={next} />
      </div>
    </main>
  );
}
