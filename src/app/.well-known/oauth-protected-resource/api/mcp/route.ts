// The same document at the path-suffixed address some clients try first (RFC 9728 §3.1).
import { json, protectedResourceMetadata } from "@/lib/mcp/http";

export const dynamic = "force-dynamic";

export function GET() {
  return json(protectedResourceMetadata());
}
