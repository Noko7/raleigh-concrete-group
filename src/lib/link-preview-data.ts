// Server only: the two fields a job link's preview card shows, read with the service role by the job link's
// token (the same capability the link itself carries). Nothing else about the job is read.
import { pgAdmin } from "@/lib/crm/rest";

import { JOB_TOKEN } from "./link-preview";

export async function previewFieldsFor(token: string): Promise<{ name: string; service: string | null } | null> {
  if (!JOB_TOKEN.test(token)) return null;
  try {
    const res = await pgAdmin(`quote_requests?job_token=eq.${token}&select=name,service&limit=1`);
    if (!res.ok) return null;
    const rows = (await res.json()) as { name: string; service: string | null }[];
    return rows[0] ?? null;
  } catch {
    return null;
  }
}
