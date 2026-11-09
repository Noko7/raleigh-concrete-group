// The token endpoint: an approval code (with its PKCE verifier) becomes tokens, and a refresh token is swapped,
// once, for a new pair. Every refusal is the same vague invalid_grant, so a guess learns nothing.
import { basicAuth, json, oauthError, parseParams, readBody, who } from "@/lib/mcp/http";
import { pkceMatches, tokenKindOf } from "@/lib/mcp/policy";
import {
  activeOwner,
  clientSecretOk,
  connectorEnabled,
  consumeCode,
  createGrant,
  getClient,
  logActivity,
  revokeGrant,
  rotateRefresh,
  type Client,
} from "@/lib/mcp/store";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BAD_GRANT = "The code or refresh token is invalid, expired or already used.";

export async function POST(request: Request) {
  const { ip, ua } = who(request);
  if (await rateLimit(`mcp-token:${ip}`, 30, 60 * 1000)) {
    return oauthError("temporarily_unavailable", "Too many requests.", 429);
  }

  const text = await readBody(request);
  const params = text === null ? null : parseParams(text, request.headers.get("content-type"));
  if (!params) return oauthError("invalid_request", "Malformed request.");

  // The client: public (PKCE only) or with a secret, sent either way RFC 6749 allows.
  const basic = basicAuth(request.headers.get("authorization"));
  const clientId = basic?.id ?? params.client_id ?? "";
  if (basic && params.client_id && params.client_id !== basic.id) return oauthError("invalid_request", "Two different client ids.");
  const client: Client | null = await getClient(clientId).catch(() => null);
  if (!client || !clientSecretOk(client, basic?.secret ?? params.client_secret ?? null)) {
    return oauthError("invalid_client", "Unknown client or wrong client credentials.", 401);
  }

  if (!(await connectorEnabled())) {
    return oauthError("access_denied", "The Claude connector is turned off in the CRM's Security page.", 403);
  }

  try {
    if (params.grant_type === "authorization_code") {
      const code = params.code ?? "";
      if (tokenKindOf(code) !== "code") return oauthError("invalid_grant", BAD_GRANT);
      // Spent the moment it's read, whatever happens next.
      const row = await consumeCode(code);
      if (
        !row ||
        row.client_id !== client.client_id ||
        row.redirect_uri !== (params.redirect_uri ?? "") ||
        !pkceMatches(params.code_verifier ?? "", row.code_challenge)
      ) {
        await logActivity({ kind: "refused", ok: false, clientName: client.client_name, detail: "bad approval code exchange", ip, ua });
        return oauthError("invalid_grant", BAD_GRANT);
      }
      const owner = await activeOwner(row.staff_id);
      if (!owner) return oauthError("invalid_grant", BAD_GRANT);

      const { grantId, tokens } = await createGrant({
        clientId: client.client_id,
        staffId: owner.id,
        scope: row.scope,
        clientName: client.client_name,
        ip,
      });
      await logActivity({ kind: "connect", ok: true, grantId, staffId: owner.id, clientName: client.client_name, detail: "connected", ip, ua });
      return json({ token_type: "Bearer", ...tokens });
    }

    if (params.grant_type === "refresh_token") {
      const token = params.refresh_token ?? "";
      if (tokenKindOf(token) !== "refresh") return oauthError("invalid_grant", BAD_GRANT);
      const r = await rotateRefresh(token, client.client_id);
      if (!r.ok) {
        if (r.reason === "reused") {
          await logActivity({
            kind: "revoke",
            ok: false,
            grantId: r.grant?.id,
            staffId: r.grant?.staff_id,
            clientName: client.client_name,
            detail: "A used refresh token was presented again; the connection was revoked as a precaution.",
            ip,
            ua,
          });
        }
        return oauthError("invalid_grant", BAD_GRANT);
      }
      // Re-checked on every refresh: an owner who lost access takes the connection with them.
      if (!(await activeOwner(r.grant.staff_id))) {
        await revokeGrant(r.grant.id, "owner no longer has access");
        return oauthError("invalid_grant", BAD_GRANT);
      }
      await logActivity({ kind: "refresh", ok: true, grantId: r.grant.id, staffId: r.grant.staff_id, clientName: r.grant.client_name, ip, ua });
      return json({ token_type: "Bearer", ...r.tokens });
    }

    return oauthError("unsupported_grant_type", "Use authorization_code or refresh_token.");
  } catch {
    return oauthError("server_error", "Could not issue tokens. Try again.", 500);
  }
}
