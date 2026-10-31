import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";

import { customerStage, type AgreementSigningStatus, type Signer } from "@/lib/crm/docuseal-core";
import { ECONSENT_DISCLOSURE_PATH, ECONSENT_DISCLOSURE_TITLE } from "@/lib/crm/constants";
import { pgAdmin } from "@/lib/crm/rest";
import type { Agreement } from "@/lib/crm/types";
import { businessName, phoneDisplay, phoneHref } from "@/lib/site-data";
import { CustomerSign } from "./customer-sign";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Sign your agreement | Raleigh Concrete Group" },
  robots: { index: false, follow: false },
};

// The customer's signing page: the link texted once the contractor has signed. The token is the only key, like a
// quote link. The signing form only appears once the contractor has signed; before that, and after it is done or
// withdrawn, the page says where things stand.
export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[0-9a-f]{32}$/.test(token)) notFound();
  const res = await pgAdmin(`agreements?sign_token=eq.${token}&select=id,status,signers,completed_at,signed_pdf_path,quote:quote_requests(name)&limit=1`);
  const a = res.ok ? (((await res.json()) as (Agreement & { quote: { name: string } | null })[])[0] ?? null) : null;
  if (!a) notFound();

  const stage = customerStage(a.status as AgreementSigningStatus);
  const customer = ((Array.isArray(a.signers) ? a.signers : []) as Signer[]).find((s) => s.role === "Customer");
  const first = (a.quote?.name ?? "").trim().split(/\s+/)[0] || "there";

  return (
    <main className="cq-wrap">
      <article className="cq-card sg">
        <header className="cq-head">
          <Image src="/images/logo_horizontal.png" alt={businessName} width={967} height={243} className="cq-logo" priority />
        </header>
        {stage === "sign" && customer ? (
          <>
            <h1 className="sg-title">Hi {first}, here&apos;s your agreement</h1>
            <p className="sg-lead">
              Your contractor has signed it. Read it through, then sign at the bottom. You&apos;ll be able to download a copy when you&apos;re done.
            </p>
            <CustomerSign src={customer.embed_src} />
            <p className="sg-small">
              Signing electronically is covered by our <a href={ECONSENT_DISCLOSURE_PATH} target="_blank" rel="noreferrer">{ECONSENT_DISCLOSURE_TITLE}</a>. Questions? Call or text{" "}
              <a href={phoneHref}>{phoneDisplay}</a>.
            </p>
          </>
        ) : stage === "waiting" ? (
          <>
            <h1 className="sg-title">Almost ready</h1>
            <p className="sg-lead">Your contractor hasn&apos;t signed yet. We&apos;ll text you as soon as it&apos;s your turn.</p>
          </>
        ) : stage === "done" ? (
          <>
            <h1 className="sg-title">Signed. Thank you, {first}!</h1>
            <p className="sg-lead">Your agreement is complete. Keep a copy for your records.</p>
            {a.signed_pdf_path ? (
              <a className="cq-btn cq-btn-primary sg-dl" href={`/sign/${token}/pdf`}>
                Download your signed agreement
              </a>
            ) : (
              <p className="sg-small">Your copy is being prepared. Check back in a few minutes, or call us for a copy.</p>
            )}
          </>
        ) : (
          <>
            <h1 className="sg-title">This link is no longer active</h1>
            <p className="sg-lead">
              The agreement was changed or withdrawn. Call or text <a href={phoneHref}>{phoneDisplay}</a> and we&apos;ll send you the current one.
            </p>
          </>
        )}
      </article>
    </main>
  );
}
