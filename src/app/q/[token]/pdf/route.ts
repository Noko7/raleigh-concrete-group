import { getQuoteByToken, isOpenAgain, isQuoteExpired, listQuoteOptionsAdmin, listQuotePackagesAdmin } from "@/lib/crm/queries";
import { quotePdfResponse } from "@/lib/crm/quote-pdf-response";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

// The customer's copy. Same access as the quote page: whoever holds the
// unguessable public_token, and only while the page would show a price.
// Staff download from /crm/api/quote-pdf, which has no such limits.
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (await rateLimit(`qpdf:${clientIp(request)}`, 30, 10 * 60 * 1000)) {
    return new Response("Too many requests", { status: 429, headers: { "Cache-Control": "no-store" } });
  }

  const quote = await getQuoteByToken("public_token", token);
  // No price yet, or the offer ran out: the page shows no price either.
  if (!quote || quote.quote_amount == null || isQuoteExpired(quote)) return notFound();

  const [options, packages] = await Promise.all([listQuoteOptionsAdmin(quote.id), listQuotePackagesAdmin(quote.id)]);
  return quotePdfResponse({
    quote,
    options,
    packages,
    // Answers only count once approved; a decline stamps every row and would
    // otherwise print as "Not included".
    accepted: !isOpenAgain(quote) && quote.customer_response === "accepted",
    goodThrough: true,
    link: true,
  });
}
