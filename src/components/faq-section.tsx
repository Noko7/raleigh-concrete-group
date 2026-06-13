import type { FaqItem } from "@/lib/site-data";

// Accessible FAQ accordion using native <details>/<summary> (no client JS).
// Pair with faqSchema() so the visible content matches the FAQPage markup.
export function FaqSection({
  faqs,
  heading = "Frequently Asked Questions",
}: {
  faqs: FaqItem[];
  heading?: string;
}) {
  if (faqs.length === 0) return null;

  return (
    <section className="mx-auto w-full max-w-3xl px-4 pb-14 md:px-8">
      <h2 className="mb-6 font-headline text-4xl text-ivory">{heading}</h2>
      <div className="divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10 bg-white/5">
        {faqs.map((faq) => (
          <details key={faq.q} className="group px-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-left font-headline text-xl text-ivory marker:hidden">
              {faq.q}
              <span className="shrink-0 text-amber-accent transition-transform duration-200 group-open:rotate-45">
                +
              </span>
            </summary>
            <p className="pb-5 text-base leading-relaxed text-slate-300">{faq.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
