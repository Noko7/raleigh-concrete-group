import Link from "next/link";

import { requireSession } from "@/lib/crm/auth";
import { crmBase } from "@/lib/crm/nav";
import { parseAuthorize, withQuery } from "@/lib/mcp/policy";
import { connectorEnabled, getClient, ISSUER, MCP_URL } from "@/lib/mcp/store";
import { decideConnection } from "./actions";

export const dynamic = "force-dynamic";

// The approval screen Claude sends an owner to (the OAuth authorization endpoint). The middleware has already
// made them sign in. Owners only; the connector must be switched on in Security.
export default async function ConnectPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const base = await crmBase();
  const raw = await searchParams;
  // A repeated parameter is malformed; treat it as missing.
  const sp: Record<string, string | undefined> = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, typeof v === "string" ? v : undefined]),
  );

  const shell = (title: string, body: React.ReactNode) => (
    <main className="crm-page crm-page-narrow">
      <div className="crm-page-head">
        <div>
          <h1>{title}</h1>
        </div>
      </div>
      <div className="crm-card">{body}</div>
    </main>
  );

  if (session.staff.role !== "owner") {
    return shell("Connect Claude", <p>Only an owner can connect Claude to the CRM.</p>);
  }
  if (sp.error === "off" || !(await connectorEnabled())) {
    return shell(
      "The Claude connector is off",
      <p>
        Turn it on in <Link href={`${base}/security#claude`}>Security</Link>, then start the connection from Claude again.
      </p>,
    );
  }
  if (sp.error === "invalid") {
    return shell("Couldn't connect", <p>That request wasn&apos;t valid any more. Start the connection from Claude again.</p>);
  }

  const client = await getClient(sp.client_id ?? "").catch(() => null);
  const parsed = parseAuthorize(sp, client ? { redirectUris: client.redirect_uris } : null, MCP_URL);
  if (!parsed.ok && !parsed.redirectable) {
    return shell("Couldn't connect", <p>{parsed.error} Start the connection from Claude again.</p>);
  }
  if (!parsed.ok) {
    // Known app, malformed request: say so here, with the standard error to hand back.
    const back = withQuery(parsed.redirectUri, { error: parsed.error, error_description: parsed.description, state: parsed.state, iss: ISSUER });
    return shell(
      "Couldn't connect",
      <>
        <p>{parsed.description}</p>
        <p>
          <a className="crm-btn crm-btn-ghost" href={back}>
            Back to Claude
          </a>
        </p>
      </>,
    );
  }

  const { value } = parsed;
  const destination = new URL(value.redirectUri);
  const where = destination.protocol === "http:" ? "Claude Code on this computer" : destination.hostname;
  const ownerName = session.staff.full_name || session.staff.email || "you";

  return shell(
    "Connect Claude to the CRM?",
    <form action={decideConnection}>
      {(["client_id", "redirect_uri", "response_type", "state", "code_challenge", "code_challenge_method", "scope", "resource"] as const).map(
        (f) => (sp[f] === undefined ? null : <input key={f} type="hidden" name={f} value={sp[f]} />),
      )}
      <p>
        <strong>{client!.client_name}</strong> is asking to read the CRM as <strong>{ownerName}</strong>. It will return to{" "}
        <strong>{where}</strong>.
      </p>
      <p className="crm-muted crm-sm">It will be able to read:</p>
      <ul className="crm-sm">
        <li>Jobs and quotes: customer name, phone, email, address, what they asked for, price, sections and status</li>
        <li>Each job&apos;s history and the texts the CRM sent (private links masked)</li>
        <li>The crew list and their open jobs</li>
      </ul>
      <p className="crm-muted crm-sm">It can&apos;t change anything, send texts, take payments, or see passwords or payment details.</p>
      <p className="crm-muted crm-sm">
        The connection lasts up to 90 days. Every request it makes is logged, and you can disconnect it at any time in{" "}
        <Link href={`${base}/security#claude`}>Security</Link>.
      </p>
      <p className="crm-muted crm-sm">Only approve if you just started this from Claude yourself.</p>
      <div style={{ display: "flex", gap: "0.6rem", marginTop: "1rem" }}>
        <button type="submit" name="decision" value="approve" className="crm-btn crm-btn-primary">
          Approve read-only access
        </button>
        <button type="submit" name="decision" value="deny" className="crm-btn crm-btn-ghost">
          Deny
        </button>
      </div>
    </form>,
  );
}
