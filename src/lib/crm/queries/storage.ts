// Server-only CRM data access: signed URLs for private storage. Re-exported from ../queries.ts.
import { SUPABASE_URL, SERVICE_KEY, UPLOAD_BUCKET } from "../env";

// Short-lived signed URL for one private storage object (path = "bucket/obj").
export async function signFile(storagePath: string, expiresIn = 3600): Promise<string | null> {
  const prefix = `${UPLOAD_BUCKET}/`;
  const obj = storagePath.startsWith(prefix) ? storagePath.slice(prefix.length) : storagePath;
  // Only sign objects inside our bucket; reject traversal / absolute paths.
  if (!obj || obj.includes("..") || obj.startsWith("/")) return null;
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${UPLOAD_BUCKET}/${obj}`, {
    method: "POST",
    cache: "no-store",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { signedURL?: string };
  return json.signedURL ? `${SUPABASE_URL}/storage/v1${json.signedURL}` : null;
}

export async function signFiles(paths: string[], expiresIn = 3600): Promise<{ path: string; url: string | null }[]> {
  return Promise.all(paths.map(async (p) => ({ path: p, url: await signFile(p, expiresIn) })));
}
