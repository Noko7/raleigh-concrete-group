import type { Metadata } from "next";
import Link from "next/link";

import { MobileBar, SiteFooter } from "@/components/site-chrome";
import { SiteHeader } from "@/components/site-header";
import { businessName, phoneDisplay, phoneHref } from "@/lib/site-data";

const EFFECTIVE_DATE = "June 17, 2026";

export const metadata: Metadata = {
  title: "SMS Terms of Service",
  description:
    "SMS Terms of Service for Raleigh Concrete Group: consent, message frequency, rates, STOP/HELP opt-out, supported carriers, and privacy, in accordance with A2P 10DLC requirements.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <>
      <SiteHeader />
      <main>
        <section className="mx-auto w-full max-w-3xl px-4 pb-16 pt-12 md:px-8 md:pt-16">
          <h1 className="mb-2 font-headline text-5xl text-ivory md:text-6xl">SMS Terms of Service</h1>
          <p className="mb-10 text-sm font-semibold uppercase tracking-[0.14em] text-slate-400">
            Effective Date: {EFFECTIVE_DATE}
          </p>

          <div className="legal-prose">
            <p>
              {businessName} (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;) provides text
              messaging services to communicate with our customers. By providing your phone number and
              consenting to receive text messages, you agree to these SMS Terms of Service.
            </p>

            <h2>1. Consent</h2>
            <p>
              By checking the consent box on our estimate form or by verbally consenting during a phone
              call, you agree to receive recurring automated text messages from {businessName} at the
              phone number you provided. These messages may include:
            </p>
            <ul>
              <li>Project quotes and estimates</li>
              <li>Appointment scheduling and confirmations</li>
              <li>Project updates and reminders</li>
              <li>Follow-up messages and review requests</li>
            </ul>

            <h2>2. Message Frequency</h2>
            <p>
              You may receive 2&ndash;8 text messages per project (typically 3&ndash;6 messages total).
              Message frequency may vary.
            </p>

            <h2>3. Message &amp; Data Rates</h2>
            <p>Message and data rates may apply. Check with your mobile carrier for details.</p>

            <h2>4. Opt-Out Instructions</h2>
            <p>
              You can opt out of receiving text messages at any time by replying STOP to any message we
              send. After you reply STOP, we will send one final confirmation message and then stop
              sending you SMS messages. You may also opt out by contacting us at{" "}
              <a href={phoneHref}>{phoneDisplay}</a>.
            </p>

            <h2>5. Help Requests</h2>
            <p>If you need help, reply HELP to any message or contact us directly.</p>

            <h2>6. Supported Carriers</h2>
            <p>
              Our text messaging service works with most major U.S. carriers. However, availability may
              vary.
            </p>

            <h2>7. Changes to These Terms</h2>
            <p>
              We reserve the right to update these SMS Terms of Service. We will notify you of material
              changes via text message or our website.
            </p>

            <h2>8. Privacy</h2>
            <p>
              Your information is handled according to our{" "}
              <Link href="/privacy-policy">Privacy Policy</Link>.
            </p>

            <p className="legal-emphasis">
              By consenting to receive text messages, you confirm that you are the owner of the phone
              number provided or have authorization to consent on behalf of the owner.
            </p>
          </div>
        </section>

        <SiteFooter />
      </main>

      <MobileBar />
    </>
  );
}
