import type { Metadata } from "next";
import Link from "next/link";

import { SiteHeader } from "@/components/site-header";
import { businessName, links, locationKeys, locations, phoneDisplay, phoneHref } from "@/lib/site-data";

const CONTACT_EMAIL = "info@raleighconcrete.net";
const LAST_UPDATED = "June 13, 2026";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "Privacy Policy for Raleigh Concrete Group, including how we handle SMS/text messaging consent and data in accordance with A2P 10DLC requirements.",
  alternates: { canonical: "/privacy-policy" },
};

export default function PrivacyPolicyPage() {
  return (
    <>
      <SiteHeader />
      <main className="pb-24 md:pb-0">
        <section className="mx-auto w-full max-w-3xl px-4 pb-16 pt-12 md:px-8 md:pt-16">
          <h1 className="mb-2 font-headline text-5xl text-ivory md:text-6xl">Privacy Policy</h1>
          <p className="mb-10 text-sm font-semibold uppercase tracking-[0.14em] text-slate-400">
            Last updated: {LAST_UPDATED}
          </p>

          <div className="legal-prose">
            <p>
              {businessName} (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;) respects your
              privacy. This Privacy Policy explains what information we collect, how we use it, and the
              choices you have. By using our website or submitting a form, you agree to the practices
              described here.
            </p>

            <h2>Information We Collect</h2>
            <p>We collect information you provide directly to us when you request a quote or contact us, including:</p>
            <ul>
              <li>Your name, phone number, and email address</li>
              <li>Your property address and details about the project you want done</li>
              <li>Any photos, videos, or notes you choose to upload</li>
              <li>Scheduling preferences for quotes or installation</li>
            </ul>
            <p>
              We also automatically collect limited technical information (such as your browser type
              and general usage data) to operate and improve the website.
            </p>

            <h2>How We Use Your Information</h2>
            <ul>
              <li>To prepare and deliver your quote and respond to your inquiry</li>
              <li>To schedule, confirm, and remind you about appointments and installations</li>
              <li>To communicate with you about your project</li>
              <li>To operate, maintain, and improve our services</li>
              <li>To comply with legal obligations</li>
            </ul>

            <h2>SMS / Text Messaging</h2>
            <p>
              When you provide your phone number through a form on our website, you consent to receive
              SMS text messages from {businessName}. The types of messages you may receive include:
              quote request confirmations, appointment and booking reminders, project updates, and
              replies to questions you send us.
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
            <p className="legal-emphasis">
              No mobile information or SMS opt-in consent will be sold, rented, or shared with any
              third parties or affiliates for marketing or promotional purposes. The phone numbers and
              consent obtained for text messaging will only be shared with our SMS/text messaging
              service provider solely to deliver the messages described above, and for no other purpose.
            </p>

            <h2>How We Share Information</h2>
            <p>
              We do not sell your personal information. We may share information with trusted service
              providers who help us operate our business (for example, our scheduling, hosting, and
              text-messaging providers), only to the extent needed to provide those services to us, and
              with authorities when required by law. As stated above, text-messaging opt-in data and
              consent are never shared with third parties for marketing purposes.
            </p>

            <h2>Data Retention</h2>
            <p>
              We keep your information for as long as needed to provide our services, respond to your
              requests, and meet our legal and business obligations. You may request that we delete your
              information by contacting us.
            </p>

            <h2>Your Choices</h2>
            <ul>
              <li>You can opt out of text messages at any time by replying STOP.</li>
              <li>You can request access to, correction of, or deletion of your information.</li>
              <li>You can decline to provide information, though it may limit our ability to serve you.</li>
            </ul>

            <h2>Children&rsquo;s Privacy</h2>
            <p>
              Our website and services are intended for adults. We do not knowingly collect personal
              information from children under 13.
            </p>

            <h2>Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. When we do, we will revise the
              &ldquo;Last updated&rdquo; date above. Continued use of our website after changes take
              effect constitutes acceptance of the updated policy.
            </p>

            <h2>Contact Us</h2>
            <p>If you have questions about this Privacy Policy or your information, contact us:</p>
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
