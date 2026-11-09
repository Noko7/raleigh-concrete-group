// RFC 7591 dynamic client registration. Open by design (Claude registers itself before anyone signs in), so it's
// fenced: only while the connector is on, only Claude's callback addresses, and rate-limited per IP and overall.
// Registering grants nothing; the owner still has to approve on /crm/connect.
import { json, oauthError, readBody, who } from "@/lib/mcp/http";
import { parseRegistration } from "@/lib/mcp/policy";
import { connectorEnabled, logActivity, registerClient } from "@/lib/mcp/store";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { ip, ua } = who(request);
  if (await rateLimit(`mcp-register:${ip}`, 10, 60 * 60 * 1000)) {
    return oauthError("temporarily_unavailable", "Too many registrations. Try again later.", 429);
  }
  if (!(await connectorEnabled())) {
    return oauthError("access_denied", "The Claude connector is turned off. An owner can turn it on in the CRM's Security page.", 403);
  }

  const text = await readBody(request);
  if (text === null) return oauthError("invalid_client_metadata", "Request too large.", 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return oauthError("invalid_client_metadata", "Body must be JSON.");
  }
  const parsed = parseRegistration(body);
  if (!parsed.ok) {
    await logActivity({ kind: "register", ok: false, detail: parsed.error, ip, ua });
    const code = parsed.error.includes("callback") ? "invalid_redirect_uri" : "invalid_client_metadata";
    return oauthError(code, parsed.error);
  }

  // Counted only for valid requests while the connector is on, so junk can't use up the owner's day.
  if (await rateLimit("mcp-register:all", 60, 24 * 60 * 60 * 1000)) {
    return oauthError("temporarily_unavailable", "Registration is paused for today.", 429);
  }

  try {
    const { client, secret } = await registerClient(parsed.value, ip);
    await logActivity({ kind: "register", ok: true, clientName: client.client_name, detail: client.redirect_uris.join(" "), ip, ua });
    return json(
      {
        client_id: client.client_id,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        client_name: client.client_name,
        redirect_uris: client.redirect_uris,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: client.auth_method,
        scope: "crm.read",
        ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
      },
      201,
    );
  } catch {
    return oauthError("server_error", "Could not register. Try again.", 500);
  }
}
