import { readFile } from "node:fs/promises";
import path from "node:path";

import { dollars, firstNameOf, isChoice, packageLetter, QUOTE_SECTION_FIELDS, QUOTE_SECTION_LABELS, DECLINE_CREDIT } from "@/lib/crm/constants";
import { SITE_ORIGIN } from "@/lib/crm/env";
import { buildQuotePdf, type QuotePdfLine } from "@/lib/crm/quote-pdf";
import { getQuoteByToken, isOpenAgain, isQuoteExpired, listQuoteOptionsAdmin, listQuotePackagesAdmin } from "@/lib/crm/queries";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { businessName, phoneDisplay } from "@/lib/site-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// A fixed file, never a path built from the request. Bundled for this route by
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

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

// Same access as the quote page: whoever holds the unguessable public_token.
// The CRM's "Download PDF" button links here too.
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (await rateLimit(`qpdf:${clientIp(request)}`, 30, 10 * 60 * 1000)) {
    return new Response("Too many requests", { status: 429, headers: { "Cache-Control": "no-store" } });
  }

  const quote = await getQuoteByToken("public_token", token);
  // No price yet, or the offer ran out: the page shows no price either.
  if (!quote || quote.quote_amount == null || isQuoteExpired(quote)) return notFound();

  const [storedOptions, storedPackages] = await Promise.all([
    listQuoteOptionsAdmin(quote.id),
    listQuotePackagesAdmin(quote.id),
  ]);
  // Answers only count once approved; a decline stamps every row and would
  // otherwise print as "Not included".
  const accepted = !isOpenAgain(quote) && quote.customer_response === "accepted";
  const offersChoice = isChoice(storedPackages);

  const packages: QuotePdfLine[] = offersChoice
    ? storedPackages
        .filter((p) => !accepted || p.customer_response === "accepted")
        .map((p, i) => ({
          title: accepted ? p.title : `Option ${packageLetter(i)}: ${p.title}`,
          description: p.description,
          price: dollars(Number(p.amount)) ?? "$0",
          tag: accepted ? "Chosen" : p.recommended ? "Recommended" : null,
        }))
    : [];
  const lines: QuotePdfLine[] = storedOptions.map((o) => {
    const declined = accepted && !o.required && o.customer_response !== "accepted";
    return {
      title: o.title,
      description: o.description,
      price: declined ? "-" : (dollars(Number(o.amount)) ?? "$0"),
      tag: declined ? "Not included" : o.required || accepted ? null : "Optional",
    };
  });

  const hasChoices = offersChoice || storedOptions.some((o) => !o.required);
  const total = dollars(quote.quote_amount) ?? "$0";
  const totalLabel = accepted ? "Your total" : hasChoices ? "Total with everything" : "Your price, all in";
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
      goodThrough: !accepted && quote.quote_expires_at ? prettyDate(quote.quote_expires_at) : null,
      sections,
      packages,
      lines,
      totalLabel,
      total,
      totalNote,
      linkLabel: accepted ? "Your quote, payments and booking, online:" : "Ready to go ahead? Approve your quote online:",
      quoteUrl: `${SITE_ORIGIN}/q/${token}`,
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
