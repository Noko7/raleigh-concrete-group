// Server-only: the DocuSeal API, and copying signed files into our own storage.
//
// Configuration, from Vercel environment variables only (never committed, never logged):
//   DOCUSEAL_API_KEY         the account's API key (the test-mode key until counsel signs off)
//   DOCUSEAL_WEBHOOK_SECRET  the whsec_... secret DocuSeal signs webhooks with
//   DOCUSEAL_API_URL         https://api.docuseal.com (default), or the EU / self-hosted URL
import { AGREEMENT_BUCKET, SERVICE_KEY, SUPABASE_URL } from "./env";

const API_URL = (process.env.DOCUSEAL_API_URL || "https://api.docuseal.com").replace(/\/$/, "");
const API_KEY = process.env.DOCUSEAL_API_KEY || "";
export const DOCUSEAL_WEBHOOK_SECRET = process.env.DOCUSEAL_WEBHOOK_SECRET || "";

export const docusealConfigured = () => Boolean(API_KEY);

type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

async function call<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<ApiResult<T>> {
  if (!API_KEY) return { ok: false, status: 0, error: "DocuSeal isn't set up (DOCUSEAL_API_KEY is missing)." };
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      cache: "no-store",
      headers: { "X-Auth-Token": API_KEY, "Content-Type": "application/json", Accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    if (!res.ok) {
      // The body can echo what was sent (names, the document); log only the status and a short error.
      const msg = (() => {
        try {
          return String((JSON.parse(text) as { error?: unknown }).error ?? "").slice(0, 200);
        } catch {
          return "";
        }
      })();
      console.error("[docuseal]", method, path.split("?")[0], res.status, msg);
      return { ok: false, status: res.status, error: msg || `DocuSeal returned ${res.status}.` };
    }
    return { ok: true, data: (text ? JSON.parse(text) : null) as T };
  } catch (e) {
    console.error("[docuseal]", method, path.split("?")[0], "network", (e as Error).name);
    return { ok: false, status: 0, error: "Couldn't reach DocuSeal. Try again." };
  }
}

export const createHtmlSubmission = (body: Record<string, unknown>) => call<unknown>("POST", "/submissions/html", body);
export const archiveSubmission = (id: number) => call<unknown>("DELETE", `/submissions/${id}`);
export const getSubmission = (id: number) =>
  call<{ status?: string; audit_log_url?: string | null; combined_document_url?: string | null; documents?: { url?: string }[] }>(
    "GET",
    `/submissions/${id}`,
  );

/**
 * Copy a DocuSeal file (its links expire in about 40 minutes) into the private agreements bucket. Only https
 * links on DocuSeal's own hosts are fetched, so a forged URL can't make the server fetch something else.
 */
export async function storeSignedFile(url: string, objectPath: string, contentType: string): Promise<string | null> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const apiHost = new URL(API_URL).hostname;
  const allowed = u.protocol === "https:" && (u.hostname === apiHost || u.hostname.endsWith(".docuseal.com") || u.hostname === "docuseal.com" || u.hostname.endsWith(".docuseal.eu") || u.hostname === "docuseal.eu");
  if (!allowed || objectPath.includes("..")) {
    console.error("[docuseal] refused to download from", u.hostname);
    return null;
  }
  try {
    const file = await fetch(u, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
    if (!file.ok) {
      console.error("[docuseal] download failed", file.status);
      return null;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength > 25 * 1024 * 1024) return null;
    const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${AGREEMENT_BUCKET}/${objectPath}`, {
      method: "POST",
      cache: "no-store",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": contentType, "x-upsert": "true" },
      body: bytes,
    });
    if (!up.ok) {
      console.error("[docuseal] storage upload failed", up.status);
      return null;
    }
    return `${AGREEMENT_BUCKET}/${objectPath}`;
  } catch (e) {
    console.error("[docuseal] store failed", (e as Error).name);
    return null;
  }
}
