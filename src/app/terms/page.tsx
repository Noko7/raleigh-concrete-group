import type { Metadata } from "next";
import Link from "next/link";

import { SiteHeader } from "@/components/site-header";
import { businessName, links, locationKeys, locations, phoneDisplay, phoneHref } from "@/lib/site-data";

const CONTACT_EMAIL = "info@raleighconcrete.net";
const LAST_UPDATED = "June 15, 2026";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "Terms of Service for RaleighConcrete.net, including SMS/text messaging terms and disclaimers about independent contractors.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <>
      <SiteHeader />
      <main className="pb-24 md:pb-0">
        <section className="mx-auto w-full max-w-3xl px-4 pb-16 pt-12 md:px-8 md:pt-16">
          <h1 className="mb-2 font-headline text-5xl text-ivory md:text-6xl">Terms of Service</h1>
          <p className="mb-10 text-sm font-semibold uppercase tracking-[0.14em] text-slate-400">
            Last updated: {LAST_UPDATED}
          </p>

          <div className="legal-prose">
            <p>
              These Terms of Service (&ldquo;Terms&rdquo;) govern your use of RaleighConcrete.net and the
              services offered by {businessName} (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;).
              By using this website or submitting a form, you agree to these Terms. If you do not agree,
              please do not use the site.
            </p>

            <h2>About Our Service</h2>
            <p>
              RaleighConcrete.net is a service to assist homeowners in connecting with local service
              contractors. All contractors are independent, and this site does not warrant or guarantee
              any work performed. It is the responsibility of the homeowner to verify that the hired
              contractor furnishes the necessary license and insurance required for the work being
              performed. All persons depicted in a photo or video are actors or models and not
              contractors listed on this site.
            </p>

            <h2>No Warranty; Independent Contractors</h2>
            <p>
              Any contractor introduced through this site is an independent third party. We do not
              employ, supervise, or control the contractors and are not responsible for the quality,
              timing, safety, legality, or outcome of any work they perform. You are solely responsible
              for evaluating, selecting, contracting with, and paying any contractor, and for confirming
              their licensing, insurance, and qualifications before work begins.
            </p>

            <h2>SMS / Text Messaging</h2>
            <p>
              When you provide your phone number through a form on our website and check the consent box,
              you agree to receive recurring automated text messages from {businessName} at the phone
              number provided regarding your project quotes, appointments, and updates.
            </p>
            <ul>
              <li>
                <strong>Message frequency varies</strong> based on your interactions with us.
              </li>
              <li>
                <strong>Message and data rates may apply</strong>, depending on your mobile carrier and plan.
              </li>
              <li>
                Reply <strong>HELP</strong> for help, or contact us at {phoneDisplay}.
              </li>
              <li>
                Reply <strong>STOP</strong> at any time to unsubscribe and stop receiving text messages.
              </li>
            </ul>
            <p>
              See our{" "}
              <Link href="/privacy-policy">Privacy Policy</Link> for details on how we handle the
              information you provide. No mobile information or SMS opt-in consent is sold, rented, or
              shared with third parties for marketing purposes.
            </p>

            <h2>Acceptable Use</h2>
            <p>
              You agree to provide accurate information, to use the site only for lawful purposes, and not
              to interfere with, disrupt, or attempt to gain unauthorized access to the site or its
              systems.
            </p>

            <h2>Intellectual Property</h2>
            <p>
              The content, branding, and materials on this site are owned by {businessName} or its
              licensors and may not be copied or reused without permission.
            </p>

            <h2>Limitation of Liability</h2>
            <p>
              To the fullest extent permitted by law, {businessName} is not liable for any indirect,
              incidental, or consequential damages arising from your use of the site or from any work
              performed by an independent contractor. The site is provided &ldquo;as is&rdquo; without
              warranties of any kind.
            </p>

            <h2>Changes to These Terms</h2>
            <p>
              We may update these Terms from time to time. When we do, we will revise the &ldquo;Last
              updated&rdquo; date above. Continued use of the site after changes take effect constitutes
              acceptance of the updated Terms.
            </p>

            <h2>Contact Us</h2>
            <p>If you have questions about these Terms, contact us:</p>
            <ul>
              <li>{businessName}</li>
              <li>
                Phone: <a href={phoneHref}>{phoneDisplay}</a>
              </li>
              <li>
                Email: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
              </li>
            </ul>
          </div>
        </section>

        <footer className="border-t border-white/10 bg-black/20">
          <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-8">
            <div className="mb-5 flex flex-wrap gap-2">
              <span className="mr-2 text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
                Serving:
              </span>
              {locationKeys.map((key) => (
                <Link
                  key={key}
                  href={`/${key}`}
                  className="text-sm font-semibold text-slate-300 transition hover:text-amber-accent"
                >
                  {locations[key].city}
                </Link>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-5">
              <span className="font-headline text-2xl text-ivory">{businessName}</span>
              <p className="text-right text-xs font-semibold uppercase tracking-[0.14em] text-slate-300">
                {businessName} &middot; Concrete &amp; Hardscaping &middot; {phoneDisplay}
              </p>
            </div>
          </div>
        </footer>
      </main>

      <div className="mobile-bar">
        <a href="/#quote" className="cta-primary flex-1 justify-center">Free Estimate</a>
        <a href={links.call} className="cta-secondary flex-1 justify-center">Call</a>
        <a href={links.text} className="cta-secondary flex-1 justify-center">Text</a>
      </div>
    </>
  );
}
