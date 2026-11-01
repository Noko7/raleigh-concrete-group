import { receiptByToken } from "@/lib/crm/receipts";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { receiptPdfResponse } from "../receipt-pdf-file";
import { logDataOut } from "@/lib/crm/request-log-write";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

// The receipt's PDF. Same access as its page: whoever holds the unguessable token.
async function serve(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (await rateLimit(`rpdf:${clientIp(request)}`, 30, 10 * 60 * 1000)) {
    return new Response("Too many requests", { status: 429, headers: { "Cache-Control": "no-store" } });
  }
  const receipt = await receiptByToken(token);
  if (!receipt) return notFound();
  return receiptPdfResponse(receipt);
}

// Logged for the security page: who downloaded this, and how many bytes went out.
export async function GET(request: Request, ctx: { params: Promise<{ token: string }> }) {
  return logDataOut(request, await serve(request, ctx));
}
