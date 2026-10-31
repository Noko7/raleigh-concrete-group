import type { Metadata } from "next";

import { MobileBar, SiteFooter } from "@/components/site-chrome";
import { SiteHeader } from "@/components/site-header";
import { ECONSENT_DISCLOSURE_PATH, ECONSENT_DISCLOSURE_TITLE, ECONSENT_VERSION } from "@/lib/crm/constants";
import { businessName, phoneDisplay, phoneHref } from "@/lib/site-data";

// The page the consent box on a customer's quote links to. Its version is ECONSENT_VERSION: change both
// together, so every stored consent points at the words that were on this page when it was given.
const EFFECTIVE_DATE = "October 31, 2026";
const OFFICE_EMAIL = "info@raleighconcrete.net";

export const metadata: Metadata = {
  title: ECONSENT_DISCLOSURE_TITLE,
  description: `How ${businessName} and its contractors deliver contracts, estimates, change orders and other project documents electronically, and how to get paper copies or withdraw consent.`,
  alternates: { canonical: ECONSENT_DISCLOSURE_PATH },
};

export default function ElectronicRecordsPage() {
  return (
    <>
      <SiteHeader />
      <main>
        <section className="mx-auto w-full max-w-3xl px-4 pb-16 pt-12 md:px-8 md:pt-16">
          <h1 className="mb-2 font-headline text-5xl text-ivory md:text-6xl">{ECONSENT_DISCLOSURE_TITLE}</h1>
          <p className="mb-10 text-sm font-semibold uppercase tracking-[0.14em] text-slate-400">
            Effective Date: {EFFECTIVE_DATE} &middot; Version {ECONSENT_VERSION}
          </p>

          <div className="legal-prose">
            <p>
              {businessName} (&ldquo;we&rdquo;) books concrete projects that are performed by independent
              contractors. Before you approve a quote, we ask for your consent to receive and sign the documents
              for your project electronically. This page explains what that covers and your rights.
            </p>

            <h2>1. What this consent covers</h2>
            <p>
              Your consent applies to documents for the project you are approving, from us and from the contractor
              performing the work, including:
            </p>
            <ul>
              <li>Estimates and quotes</li>
              <li>The customer agreement and work authorization, and any amendments</li>
              <li>Change orders</li>
              <li>Invoices and receipts</li>
              <li>Notices about your project, including notices you have a right to receive</li>
            </ul>
            <p>
              Documents may be delivered by a link sent by text message or email, or shown on a web page we send
              you. You may be asked to sign or initial them electronically. An electronic signature has the same
              effect as a handwritten one.
            </p>

            <h2>2. Paper copies</h2>
            <p>
              You may ask for a paper copy of any document at any time, at no charge. Call or text us at{" "}
              <a href={phoneHref}>{phoneDisplay}</a> or email <a href={`mailto:${OFFICE_EMAIL}`}>{OFFICE_EMAIL}</a>{" "}
              with your name, address and the document you need. Asking for a paper copy does not withdraw your
              consent.
            </p>

            <h2>3. Withdrawing your consent</h2>
            <p>
              You may withdraw your consent to electronic records at any time by calling, texting or emailing us
              using the contact details above. There is no fee. After you withdraw, we will send future documents on
              paper by mail, which may take longer. We note your choice on your project so documents stop going out
              electronically. Withdrawing does not affect documents you already received or signed electronically.
            </p>

            <h2>4. Keeping your contact details current</h2>
            <p>
              Let us know if your mobile number or email address changes, using the contact details above, so
              your documents reach you.
            </p>

            <h2>5. What you need</h2>
            <ul>
              <li>A phone, tablet or computer with a current web browser and an internet connection</li>
              <li>A mobile number that can receive text messages, or an email address</li>
              <li>The ability to view and save PDF files, or to print them</li>
            </ul>
            <p>
              By ticking the consent box before approving your quote, you confirm that you can open and read this
              page and that you meet these requirements. If you can&apos;t open or save a PDF, ask us for paper copies
              instead.
            </p>

            <h2>6. Keeping copies</h2>
            <p>
              When a document is fully signed, you can download it from the signing page, and a copy is emailed to you
              when we have your email address. Please download or print a copy for your records. You can also ask us for a copy at any time.
            </p>

            <h2>7. Questions</h2>
            <p>
              Call or text <a href={phoneHref}>{phoneDisplay}</a> or email{" "}
              <a href={`mailto:${OFFICE_EMAIL}`}>{OFFICE_EMAIL}</a>.
            </p>
          </div>
        </section>

        <SiteFooter />
      </main>

      <MobileBar />
    </>
  );
}
