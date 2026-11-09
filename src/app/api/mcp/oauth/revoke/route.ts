// RFC 7009: Claude disconnecting. Revokes the whole connection the token belongs to. Always 200, so it can't be
// used to test whether a token exists (§2.2).
import { basicAuth, json, parseParams, readBody, who } from "@/lib/mcp/http";
import { tokenKindOf } from "@/lib/mcp/policy";
import { clientSecretOk, getClient, grantIdForAnyToken, logActivity, revokeGrant } from "@/lib/mcp/store";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { ip, ua } = who(request);
  if (await rateLimit(`mcp-revoke:${ip}`, 30, 60 * 1000)) return json({}, 429);

  const text = await readBody(request);
  const params = text === null ? null : parseParams(text, request.headers.get("content-type"));
  const token = params?.token ?? "";
  const kind = tokenKindOf(token);
  if (!params || (kind !== "access" && kind !== "refresh")) return json({});

  try {
    const basic = basicAuth(request.headers.get("authorization"));
    const client = await getClient(basic?.id ?? params.client_id ?? "");
    if (!client || !clientSecretOk(client, basic?.secret ?? params.client_secret ?? null)) return json({});
    const found = await grantIdForAnyToken(token);
    // Only the app the token was issued to can revoke it.
    if (found && found.clientId === client.client_id) {
      await revokeGrant(found.grantId, "disconnected from Claude");
      await logActivity({ kind: "revoke", ok: true, grantId: found.grantId, clientName: client.client_name, detail: "disconnected from Claude", ip, ua });
    }
  } catch {
    // Still 200: the caller can't act on our failure.
  }
  return json({});
}
