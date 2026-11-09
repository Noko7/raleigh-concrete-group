"use server";

// Approve or deny a Claude connection. Everything is re-checked here from the submitted request; nothing on the
// page is trusted. Server actions also refuse cross-site posts (Next checks Origin against Host).
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { requireOwner } from "@/lib/crm/auth";
import { parseAuthorize, withQuery } from "@/lib/mcp/policy";
import { activeOwner, connectorEnabled, getClient, ISSUER, issueCode, logActivity, MCP_URL } from "@/lib/mcp/store";

const FIELDS = ["client_id", "redirect_uri", "response_type", "state", "code_challenge", "code_challenge_method", "scope", "resource"];

export async function decideConnection(formData: FormData): Promise<void> {
  const session = await requireOwner();
  const h = await headers();
  const ip = (h.get("x-real-ip") ?? "").slice(0, 64);
  const ua = (h.get("user-agent") ?? "").slice(0, 300);

  const params: Record<string, string | undefined> = {};
  for (const f of FIELDS) {
    const v = formData.get(f);
    if (typeof v === "string") params[f] = v;
  }
  const client = await getClient(params.client_id ?? "");
  const parsed = parseAuthorize(params, client ? { redirectUris: client.redirect_uris } : null, MCP_URL);
  // A request that can't be answered safely stays on our page.
  if (!parsed.ok) redirect("/crm/connect?error=invalid");

  const { value } = parsed;
  const back = (extra: Record<string, string | null>) => withQuery(value.redirectUri, { ...extra, state: value.state, iss: ISSUER });

  if (formData.get("decision") !== "approve") {
    await logActivity({ kind: "deny", ok: true, staffId: session.staff.id, clientName: client!.client_name, detail: "owner declined", ip, ua });
    redirect(back({ error: "access_denied", error_description: "The owner declined." }));
  }

  if (!(await connectorEnabled())) redirect("/crm/connect?error=off");
  if (!(await activeOwner(session.staff.id))) redirect("/crm");

  const code = await issueCode({
    clientId: client!.client_id,
    staffId: session.staff.id,
    redirectUri: value.redirectUri,
    codeChallenge: value.codeChallenge,
    scope: value.scope,
  });
  redirect(back({ code }));
}
