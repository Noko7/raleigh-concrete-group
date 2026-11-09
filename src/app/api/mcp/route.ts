// The Claude connector: an MCP server (Streamable HTTP, stateless, JSON replies). Every request must carry a
// live access token from /api/mcp/oauth/token; each one is checked against its connection, the owner behind it
// and the Security page's switch before anything is read. Read-only tools only (src/lib/mcp/tools.ts).
import { NextResponse } from "next/server";

import { json, readBody, unauthorized, who } from "@/lib/mcp/http";
import { bearerOf, tokenKindOf } from "@/lib/mcp/policy";
import { handleRpc, type CallRecord } from "@/lib/mcp/rpc";
import { activeOwner, CONNECTOR_ORIGIN, connectorEnabled, grantForAccessToken, logActivity, revokeGrant, touchGrant } from "@/lib/mcp/store";
import { TOOLS } from "@/lib/mcp/tools";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  const { ip, ua } = who(request);

  // DNS rebinding / browser pages: Claude's servers and Claude Code send no Origin; a browser always does.
  const origin = request.headers.get("origin");
  if (origin && origin !== CONNECTOR_ORIGIN) return json({ error: "Origin not allowed." }, 403);

  if (await rateLimit(`mcp-ip:${ip}`, 120, 60 * 1000)) return json({ error: "Too many requests." }, 429, { "Retry-After": "60" });

  const token = bearerOf(request.headers.get("authorization"));
  if (!token || tokenKindOf(token) !== "access") return unauthorized("Sign in to the CRM to connect.");

  let grant;
  try {
    grant = await grantForAccessToken(token);
  } catch {
    return json({ error: "The CRM is unavailable." }, 503);
  }
  if (!grant) return unauthorized("This connection has expired or was disconnected.");

  if (!(await connectorEnabled())) {
    return json({ error: "The Claude connector is turned off in the CRM's Security page." }, 403);
  }
  // A database hiccup is a retry, not a reason to end the connection.
  let owner;
  try {
    owner = await activeOwner(grant.staff_id);
  } catch {
    return json({ error: "The CRM is unavailable." }, 503);
  }
  if (!owner) {
    await revokeGrant(grant.id, "owner no longer has access");
    return unauthorized("The account behind this connection no longer has CRM access.");
  }
  if (await rateLimit(`mcp-grant:${grant.id}`, 600, 60 * 60 * 1000)) {
    return json({ error: "Hourly limit reached for this connection." }, 429, { "Retry-After": "600" });
  }

  const text = await readBody(request, 65_536);
  if (text === null) return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request too large" } }, 413);
  let message: unknown;
  try {
    message = JSON.parse(text);
  } catch {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
  }

  const calls: CallRecord[] = [];
  const out = await handleRpc(message, TOOLS, (c) => calls.push(c));
  await Promise.all([
    touchGrant(grant.id, ip),
    ...calls.map((c) =>
      logActivity({
        kind: "tool",
        ok: c.ok,
        grantId: grant.id,
        staffId: grant.staff_id,
        clientName: grant.client_name,
        tool: c.tool,
        detail: `${c.args ? JSON.stringify(c.args).slice(0, 300) : ""}${c.args ? " · " : ""}${c.detail}`,
        ip,
        ua,
      }),
    ),
  ]);

  if (out.body === null) return new NextResponse(null, { status: out.status, headers: { "Cache-Control": "no-store" } });
  return json(out.body, out.status);
}

// No server-to-client stream and no sessions: stateless JSON only (the spec's 405 for both).
export function GET() {
  return json({ error: "Use POST." }, 405, { Allow: "POST" });
}

export function DELETE() {
  return json({ error: "No sessions to end." }, 405, { Allow: "POST" });
}
