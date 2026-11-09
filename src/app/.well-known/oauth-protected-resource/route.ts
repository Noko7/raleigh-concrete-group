// RFC 9728: where Claude learns which server signs it in to /api/mcp.
import { json, protectedResourceMetadata } from "@/lib/mcp/http";

export const dynamic = "force-dynamic";

export function GET() {
  return json(protectedResourceMetadata());
}
