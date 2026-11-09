"use server";

// The Claude connector's controls on the Security page. Owners only, checked on every action.
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { requireOwner } from "@/lib/crm/auth";
import { logActivity, revokeAllGrants, revokeGrant, setConnectorEnabled } from "@/lib/mcp/store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function where() {
  const h = await headers();
  return { ip: (h.get("x-real-ip") ?? "").slice(0, 64), ua: (h.get("user-agent") ?? "").slice(0, 300) };
}

export async function setClaudeConnector(formData: FormData): Promise<void> {
  const session = await requireOwner();
  const on = formData.get("on") === "true";
  const ok = await setConnectorEnabled(on);
  await logActivity({
    kind: on ? "connect" : "revoke",
    ok,
    staffId: session.staff.id,
    detail: on ? "connector turned on" : "connector turned off",
    ...(await where()),
  });
  revalidatePath("/crm/security");
}

export async function disconnectClaude(formData: FormData): Promise<void> {
  const session = await requireOwner();
  const id = String(formData.get("grant_id") ?? "");
  if (!UUID.test(id)) return;
  const ok = await revokeGrant(id, `disconnected by ${session.staff.full_name || "an owner"}`);
  await logActivity({ kind: "revoke", ok, grantId: id, staffId: session.staff.id, detail: "disconnected from Security", ...(await where()) });
  revalidatePath("/crm/security");
}

export async function disconnectAllClaude(): Promise<void> {
  const session = await requireOwner();
  const n = await revokeAllGrants(`all disconnected by ${session.staff.full_name || "an owner"}`);
  await logActivity({ kind: "revoke", ok: true, staffId: session.staff.id, detail: `disconnected all (${n})`, ...(await where()) });
  revalidatePath("/crm/security");
}
