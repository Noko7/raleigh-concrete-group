import { getSession } from "@/lib/crm/auth";
import { getQuote, isOpenAgain, isQuoteExpired, listQuoteOptions, listQuotePackages } from "@/lib/crm/queries";
import { quotePdfResponse } from "@/lib/crm/quote-pdf-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Past quoting: the job was agreed, whether the customer tapped Approve or
// staff moved it on after a call.
const AGREED = new Set(["approved", "scheduled", "completed", "paid"]);

// The staff copy of any priced quote, whatever its stage and even once the
// customer's link has expired. Read as the signed-in user, so RLS decides
// access: the owner any quote, a contractor only jobs assigned to them.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401, headers: { "Cache-Control": "no-store" } });

  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Bad request", { status: 400, headers: { "Cache-Control": "no-store" } });

  const quote = await getQuote(session, id);
  // Nothing to print before there's a price.
  if (!quote || quote.quote_amount == null) {
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  const [options, packages] = await Promise.all([listQuoteOptions(session, id), listQuotePackages(session, id)]);
  return quotePdfResponse({
    quote,
    options,
    packages,
    accepted: (!isOpenAgain(quote) && quote.customer_response === "accepted") || AGREED.has(quote.status),
    // Once lapsed, the customer's page says "expired": no stale date, and no
    // link to a page that won't show the quote. Re-send it to open both again.
    goodThrough: !isQuoteExpired(quote),
    link: !isQuoteExpired(quote),
  });
}
