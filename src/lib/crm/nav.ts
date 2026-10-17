import { headers } from "next/headers";

// On the crm.* subdomain the app is mounted at the root; elsewhere under /crm.
export async function crmBase(): Promise<string> {
  const host = ((await headers()).get("host") ?? "").split(":")[0];
  return host.startsWith("crm.") ? "" : "/crm";
}
