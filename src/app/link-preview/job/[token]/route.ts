// What a link-preview fetcher (iMessage, WhatsApp...) gets for a crew job link when it isn't signed in: the
// middleware rewrites /job/<token> here for signed-out requests. Only the customer's initials and the job type;
// a person opening it is sent on to sign in. Signed-in crew never see this: they get the job page.
import { SITE_ORIGIN } from "@/lib/crm/env";
import { JOB_TOKEN, previewHtml, previewTitle } from "@/lib/link-preview";
import { connectorOrigin } from "@/lib/mcp/policy";
import { previewFieldsFor } from "@/lib/link-preview-data";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Referrer-Policy": "no-referrer",
};

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (await rateLimit(`link-preview:${clientIp(request)}`, 60, 60 * 1000)) {
    return new Response("Too many requests.", { status: 429, headers: { "Cache-Control": "no-store" } });
  }
  const valid = JOB_TOKEN.test(token);
  const fields = valid ? await previewFieldsFor(token) : null;
  const title = fields ? previewTitle(fields.name, fields.service) : "Raleigh Concrete Group job";
  // The main site (www), not this request's host: on crm.* the image path would be sent to sign in.
  const origin = connectorOrigin(SITE_ORIGIN);
  // The version changes with what the card shows, so a corrected name doesn't keep an old cached picture.
  const v = encodeURIComponent(title);
  const imageUrl = valid ? `${origin}/link-preview/job/${token}/image?v=${v}` : `${origin}/images/imessage-preview-image.png`;
  return new Response(previewHtml({ title, imageUrl, next: valid ? `/job/${token}` : "/crm" }), { status: 200, headers: HEADERS });
}
