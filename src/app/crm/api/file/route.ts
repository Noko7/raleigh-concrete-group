import { getSession } from "@/lib/crm/auth";
import { SUPABASE_URL, SERVICE_KEY, UPLOAD_BUCKET } from "@/lib/crm/env";

// Authenticated image/video proxy for the CRM. Streams a private storage object
// through the server (service-role) only for signed-in staff. Avoids signed-URL
// expiry and keeps job media gated behind the CRM login.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("p") ?? "";
  const prefix = `${UPLOAD_BUCKET}/`;
  const obj = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;

  // Only allow paths inside our bucket; block traversal.
  if (!obj || obj.includes("..") || obj.startsWith("/")) {
    return new Response("Bad request", { status: 400 });
  }

  const upstream = await fetch(`${SUPABASE_URL}/storage/v1/object/${UPLOAD_BUCKET}/${obj}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    cache: "no-store",
  });
  if (!upstream.ok || !upstream.body) return new Response("Not found", { status: 404 });

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
      // Don't let the browser MIME-sniff a stored object into executable HTML,
      // and force inline rendering rather than treating it as a page.
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
      "Cache-Control": "private, max-age=300",
    },
  });
}
