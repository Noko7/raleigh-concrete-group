import { headers } from "next/headers";

// On the crm.* subdomain the app is mounted at the root (clean URLs like
// /quotes/123); everywhere else it lives under /crm. This returns the right
// prefix so links and fetches resolve in both cases.
export async function crmBase(): Promise<string> {
  const host = ((await headers()).get("host") ?? "").split(":")[0];
  return host.startsWith("crm.") ? "" : "/crm";
}
