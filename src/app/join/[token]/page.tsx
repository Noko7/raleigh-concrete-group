import type { Metadata } from "next";
import Image from "next/image";

import { getUsableInvite } from "@/lib/crm/queries";
import { businessName } from "@/lib/site-data";
import { JoinForm } from "./join-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Join the crew | Raleigh Concrete Group" },
  robots: { index: false, follow: false },
};

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await getUsableInvite(token);

  // One message for every unusable case - unknown, revoked, used, expired - so
  // this page can't be used to work out which tokens exist.
  if (!invite) {
    return (
      <main className="cq-wrap">
        <div className="cq-confirm">
          <p className="cq-confirm-eyebrow cq-confirm-eyebrow-muted">Invite unavailable</p>
          <h1 className="cq-confirm-title">This link isn&apos;t valid</h1>
          <p className="cq-confirm-note">
            It may have already been used, been cancelled, or expired. Ask Raleigh Concrete Group to text you a new
            one.
          </p>
          <Image
            src="/images/logo_horizontal.png"
            alt={businessName}
            width={967}
            height={243}
            className="cq-confirm-logo"
            priority
          />
        </div>
      </main>
    );
  }

  return (
    <main className="cq-wrap">
      <div className="cq-card">
        <header className="cq-head">
          <Image
            src="/images/logo_horizontal.png"
            alt={businessName}
            width={967}
            height={243}
            className="cq-logo"
            priority
          />
          <p className="cq-eyebrow">Crew Onboarding</p>
        </header>

        <h1 className="cq-title">Set up your login</h1>
        <p className="cq-lead">
          You&apos;ve been invited to join the {businessName} crew. Fill this in and you&apos;ll be able to sign in to
          see the jobs assigned to you.
        </p>

        <JoinForm token={invite.token} defaultName={invite.full_name ?? ""} phone={invite.phone} />
      </div>
    </main>
  );
}
