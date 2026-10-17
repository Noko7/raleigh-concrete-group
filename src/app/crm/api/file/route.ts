import { getSession } from "@/lib/crm/auth";
import { SUPABASE_URL, SERVICE_KEY, UPLOAD_BUCKET } from "@/lib/crm/env";
import { verifyMediaPath } from "@/lib/crm/media-token";

// Authenticated media proxy: streams a private storage object (service role) to signed-in staff.
// A session alone isn't enough: the path must be signed for THIS viewer by the page that loaded the job
// through RLS, so contractors can't read other jobs' photos and copied URLs don't work for others.
// See lib/crm/media-token.
export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("p") ?? "";
  const prefix = `${UPLOAD_BUCKET}/`;
  const obj = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;

  // Only paths inside our bucket; block traversal.
  if (!obj || obj.includes("..") || obj.startsWith("/")) {
    return new Response("Bad request", { status: 400 });
  }

  // 403, not 404: a stale or someone else's link should prompt a reload (which mints a fresh one), not a
  // hunt for a missing photo.
  if (!verifyMediaPath(raw, searchParams.get("e"), searchParams.get("s"), session.staff.id)) {
    return new Response("Forbidden", { status: 403 });
  }

  // `w` asks Supabase to resize, so the 150px grid pulls kilobytes instead of multi-MB originals decoded
  // on the main thread. The lightbox omits it to get the original.
  // Projects without image transformations fall back to the original rather than a broken thumbnail.
  const wanted = Number(searchParams.get("w") ?? 0);
  const width = Number.isFinite(wanted) ? Math.min(1600, Math.max(0, Math.trunc(wanted))) : 0;

  const auth = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
  const original = `${SUPABASE_URL}/storage/v1/object/${UPLOAD_BUCKET}/${obj}`;
  const resized =
    `${SUPABASE_URL}/storage/v1/render/image/authenticated/${UPLOAD_BUCKET}/${obj}` +
    `?width=${width}&height=${width}&resize=contain&quality=70`;

  let upstream = width >= 64 ? await fetch(resized, { headers: auth, cache: "no-store" }) : null;
  if (!upstream?.ok || !upstream.body) {
    upstream = await fetch(original, { headers: auth, cache: "no-store" });
  }
  if (!upstream.ok || !upstream.body) return new Response("Not found", { status: 404 });

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
      // No MIME-sniffing a stored object into executable HTML; render inline.
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
      // Objects never change (new photos get new names). `private` keeps it out of shared caches.
      "Cache-Control": "private, max-age=86400",
    },
  });
}
