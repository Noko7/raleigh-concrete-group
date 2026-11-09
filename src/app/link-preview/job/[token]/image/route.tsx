// The picture on a crew job link's preview card: the customer's initials in a coloured circle and the job type.
import { ImageResponse } from "next/og";

import { colourFor, initialsOf, JOB_TOKEN, serviceFontSize, serviceLabel } from "@/lib/link-preview";
import { previewFieldsFor } from "@/lib/link-preview-data";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!JOB_TOKEN.test(token)) return new Response("Not found", { status: 404 });
  if (await rateLimit(`link-preview-img:${clientIp(request)}`, 60, 60 * 1000)) {
    return new Response("Too many requests.", { status: 429 });
  }
  const fields = await previewFieldsFor(token);
  const initials = fields ? initialsOf(fields.name) : "?";
  const service = fields ? serviceLabel(fields.service) : "Job";
  const colour = colourFor(token);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          gap: 64,
          padding: "0 90px",
          background: "#1f1a17",
          color: "#ffffff",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            width: 300,
            height: 300,
            borderRadius: 150,
            background: colour,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 140,
            fontWeight: 800,
            flexShrink: 0,
          }}
        >
          {initials}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18, width: 660 }}>
          <div style={{ fontSize: serviceFontSize(service), fontWeight: 800, lineHeight: 1.05, display: "flex", flexWrap: "wrap" }}>
            {service}
          </div>
          <div style={{ fontSize: 36, color: "#d6c7bb" }}>Raleigh Concrete Group</div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: { "Cache-Control": "public, max-age=3600", "X-Robots-Tag": "noindex, nofollow, noarchive" },
    },
  );
}
