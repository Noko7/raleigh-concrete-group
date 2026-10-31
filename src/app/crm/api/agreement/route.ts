import { getSession } from "@/lib/crm/auth";
import { AGREEMENT_BUCKET, SUPABASE_URL, SERVICE_KEY } from "@/lib/crm/env";
import { getAgreement } from "@/lib/crm/queries";

// Takes an agreement ID, not a storage path: the row is read as the user, so RLS decides access
// (owner = any; contractor = their onboarding doc or assigned jobs).
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Bad request", { status: 400 });

  const agreement = await getAgreement(session, id);
  // ?part=audit: DocuSeal's audit log for a signed agreement. Otherwise the agreement's file (the signed PDF).
  const path = searchParams.get("part") === "audit" ? agreement?.audit_log_path : agreement?.file_path;
  if (!path) return new Response("Not found", { status: 404 });

  const prefix = `${AGREEMENT_BUCKET}/`;
  const obj = path.startsWith(prefix) ? path.slice(prefix.length) : path;
  if (!obj || obj.includes("..") || obj.startsWith("/")) {
    return new Response("Bad request", { status: 400 });
  }

  const upstream = await fetch(`${SUPABASE_URL}/storage/v1/object/${AGREEMENT_BUCKET}/${obj}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    cache: "no-store",
  });
  if (!upstream.ok || !upstream.body) return new Response("Not found", { status: 404 });

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
      // No MIME-sniffing a stored file into executable HTML.
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
      "Cache-Control": "private, no-store",
    },
  });
}
