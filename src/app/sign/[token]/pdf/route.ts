import { AGREEMENT_BUCKET, SERVICE_KEY, SUPABASE_URL } from "@/lib/crm/env";
import { pgAdmin } from "@/lib/crm/rest";

export const dynamic = "force-dynamic";

// The customer's copy of their signed agreement. The token is the key; only a signed agreement's stored PDF.
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const no = (status: number) => new Response("Not found", { status, headers: { "Cache-Control": "no-store" } });
  if (!/^[0-9a-f]{32}$/.test(token)) return no(404);
  const res = await pgAdmin(`agreements?sign_token=eq.${token}&status=eq.signed&select=signed_pdf_path&limit=1`);
  const row = res.ok ? (((await res.json()) as { signed_pdf_path: string | null }[])[0] ?? null) : null;
  const prefix = `${AGREEMENT_BUCKET}/`;
  const obj = row?.signed_pdf_path?.startsWith(prefix) ? row.signed_pdf_path.slice(prefix.length) : null;
  if (!obj || obj.includes("..")) return no(404);
  const file = await fetch(`${SUPABASE_URL}/storage/v1/object/${AGREEMENT_BUCKET}/${obj}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    cache: "no-store",
  });
  if (!file.ok || !file.body) return no(404);
  return new Response(file.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="signed-agreement.pdf"',
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
