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

  // ── Thumbnails ──────────────────────────────────────────────────────────
  // A job page is a grid of 150px squares pointed at whatever came off a
  // phone: 4000x3000, several megabytes each. The browser was downloading and
  // decoding every full-size original to paint a thumbnail, which is why the
  // page stuttered as you scrolled it - lazy loading meant that work happened
  // per image, on the main thread, exactly as each one came into view.
  //
  // `w` asks Supabase to do the resizing instead, so the grid pulls tens of
  // kilobytes rather than tens of megabytes. The lightbox asks for no width
  // and still gets the original, because that is the one you opened to look at.
  //
  // Not every project has image transformations enabled, so a render that
  // comes back unhappy falls through to the original rather than showing a
  // broken thumbnail. Costs one extra upstream call in that case, on a path
  // that is then cached by the browser for a day.
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
      // Don't let the browser MIME-sniff a stored object into executable HTML,
      // and force inline rendering rather than treating it as a page.
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
      // An uploaded object never changes: a new photo arrives under a new
      // name. `private` keeps it out of any shared cache, so this is one
      // browser remembering a file it is already allowed to see, and it is
      // what stops a scroll back up the page re-fetching the whole grid.
      "Cache-Control": "private, max-age=86400",
    },
  });
}
