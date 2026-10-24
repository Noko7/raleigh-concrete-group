import { readFile } from "node:fs/promises";
import path from "node:path";

import { dollars, firstNameOf, isChoice, packageLetter, QUOTE_SECTION_FIELDS, QUOTE_SECTION_LABELS, DECLINE_CREDIT } from "@/lib/crm/constants";
import { SITE_ORIGIN } from "@/lib/crm/env";
import { buildQuotePdf, type QuotePdfLine } from "@/lib/crm/quote-pdf";
import type { Quote, QuoteOption, QuotePackage } from "@/lib/crm/types";
import { businessName, phoneDisplay } from "@/lib/site-data";

// A quote record to the PDF file, shared by the customer's link (/q/[token]/pdf)
// and the staff download (/crm/api/quote-pdf). Each route decides who may have
// it; this only decides what it says.

// A fixed file, never a path built from the request. Bundled for both routes by
// outputFileTracingIncludes in next.config.ts.
const LOGO_PATH = path.join(process.cwd(), "public", "images", "logo_horizontal.png");
let logoBytes: Promise<Uint8Array | null> | null = null;
function logo(): Promise<Uint8Array | null> {
  logoBytes ??= readFile(LOGO_PATH).then(
    (b) => new Uint8Array(b),
    () => null,
  );
  return logoBytes;
}

function prettyDate(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export async function quotePdfResponse({
  quote,
  options: storedOptions,
  packages: storedPackages,
  accepted,
  goodThrough,
  link,
}: {
  quote: Quote;
  options: QuoteOption[];
  packages: QuotePackage[];
  // Print as the agreed job (what was chosen, "Your total") rather than the offer.
  accepted: boolean;
  // Print the "Good through" date (an offer still open).
  goodThrough: boolean;
  // Print the link to the customer's quote page (false once it shows "expired").
  link: boolean;
}): Promise<Response> {
  const offersChoice = isChoice(storedPackages);
  // A job approved without the customer tapping (moved on by staff) has no
  // chosen package; then every option is shown rather than none.
  const chosenPkg = storedPackages.some((p) => p.customer_response === "accepted");
  const packages: QuotePdfLine[] = offersChoice
    ? storedPackages
        .filter((p) => !accepted || !chosenPkg || p.customer_response === "accepted")
        .map((p, i) => ({
          title: accepted && chosenPkg ? p.title : `Option ${packageLetter(i)}: ${p.title}`,
          description: p.description,
          price: dollars(Number(p.amount)) ?? "$0",
          tag: accepted && chosenPkg ? "Chosen" : p.recommended ? "Recommended" : null,
        }))
    : [];
  const lines: QuotePdfLine[] = storedOptions.map((o) => {
    const declined = accepted && !o.required && o.customer_response === "declined";
    return {
      title: o.title,
      description: o.description,
      price: declined ? "-" : (dollars(Number(o.amount)) ?? "$0"),
      tag: declined ? "Not included" : o.required || accepted ? null : "Optional",
    };
  });

  const hasChoices = offersChoice || storedOptions.some((o) => !o.required);
  const total = dollars(quote.quote_amount) ?? "$0";
  const totalLabel = accepted ? "Your total" : hasChoices ? "Total with everything" : "Your price";
  const totalNote = accepted
    ? quote.discount_accepted
      ? `Includes your $${DECLINE_CREDIT} credit.`
      : null
    : hasChoices
      ? offersChoice
        ? "Shown with the recommended option and every optional item. Your total updates as you choose when you approve online."
        : "Shown with every optional item. Your total updates as you choose when you approve online."
      : null;

  const sections = QUOTE_SECTION_FIELDS.map((f) => [QUOTE_SECTION_LABELS[f], quote[f]] as const).filter(
    (pair): pair is readonly [string, string] => Boolean(pair[1] && pair[1].trim()),
  );
  if (!sections.length && quote.quote_summary?.trim()) sections.push(["Details", quote.quote_summary]);

  const address = [quote.address, quote.city && !quote.address?.includes(quote.city) ? quote.city : null]
    .filter(Boolean)
    .join(", ");

  const pdf = await buildQuotePdf(
    {
      businessName,
      phone: phoneDisplay,
      website: new URL(SITE_ORIGIN).host,
      customerName: quote.name,
      address: address || null,
      service: quote.service,
      issuedOn: prettyDate(quote.quote_sent_at ?? new Date().toISOString()),
      goodThrough: goodThrough && !accepted && quote.quote_expires_at ? prettyDate(quote.quote_expires_at) : null,
      sections,
      packages,
      lines,
      totalLabel,
      total,
      totalNote,
      linkLabel: accepted ? "Your quote, payments and booking, online:" : "Ready to go ahead? Approve your quote online:",
      quoteUrl: link ? `${SITE_ORIGIN}/q/${quote.public_token}` : null,
    },
    await logo(),
  );

  // Letters and digits only, so nothing typed into a name reaches the header.
  const who = firstNameOf(quote.name, "").normalize("NFKD").replace(/[^A-Za-z0-9]/g, "") || "Customer";
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Raleigh-Concrete-Group-Quote-${who}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
