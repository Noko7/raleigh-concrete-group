// RFC 8414: the CRM's sign-in endpoints for the Claude connector.
import { authorizationServerMetadata, json } from "@/lib/mcp/http";

export const dynamic = "force-dynamic";

export function GET() {
  return json(authorizationServerMetadata());
}
