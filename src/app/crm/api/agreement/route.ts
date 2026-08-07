import { getSession } from "@/lib/crm/auth";
import { AGREEMENT_BUCKET, SUPABASE_URL, SERVICE_KEY } from "@/lib/crm/env";
import { getAgreement } from "@/lib/crm/queries";

// Authenticated proxy for a stored contract. Unlike the media proxy this takes
// an agreement ID rather than a storage path: the row is fetched as the
// logged-in user, so RLS decides whether they may see it (owner = any,
// contractor = their own onboarding doc or a job assigned to them). A
// contractor therefore can't read another crew member's contract by guessing.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Bad request", { status: 400 });

  const agreement = await getAgreement(session, id);
  if (!agreement?.file_path) return new Response("Not found", { status: 404 });

  const prefix = `${AGREEMENT_BUCKET}/`;
  const obj = agreement.file_path.startsWith(prefix)
    ? agreement.file_path.slice(prefix.length)
    : agreement.file_path;
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
      // Never let a stored file be MIME-sniffed into executable HTML.
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
      "Cache-Control": "private, no-store",
    },
  });
}
