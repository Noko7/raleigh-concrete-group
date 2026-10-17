import { NextResponse } from "next/server";

import { clientIp, rateLimit } from "@/lib/rate-limit";

// Free US Census Geocoder autocomplete (no key), proxied because Census sends no CORS headers. That makes
// it an open proxy on our domain, so it has its own rate limit.

type CensusMatch = { matchedAddress?: string };
type CensusResponse = { result?: { addressMatches?: CensusMatch[] } };

// Title-case words; leave state codes and ZIPs alone.
function prettyAddress(raw: string): string {
  return raw
    .split(", ")
    .map((part) => {
      if (/^[A-Z]{2}$/.test(part)) return part; // state code
      if (/^\d{5}(-\d{4})?$/.test(part)) return part; // zip
      return part
        .toLowerCase()
        .replace(/\b([a-z])/g, (m) => m.toUpperCase())
        .replace(/\b(N|S|E|W|NE|NW|SE|SW)\b/gi, (m) => m.toUpperCase());
    })
    .join(", ");
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();

  // Census needs a fairly complete address. Checked before the limiter so short queries cost no slot.
  if (q.length < 6) {
    return NextResponse.json({ suggestions: [] });
  }

  // Generous: a person typing into a debounced field. Stops loops, not the form.
  if (await rateLimit(`address:${clientIp(request)}`, 60, 5 * 60 * 1000)) {
    return NextResponse.json({ suggestions: [] }, { status: 429 });
  }

  const endpoint =
    "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress" +
    `?address=${encodeURIComponent(q)}&benchmark=Public_AR_Current&format=json`;

  try {
    const res = await fetch(endpoint, {
      headers: { "User-Agent": "RaleighConcreteGroup/1.0 (quote form)" },
    });
    if (!res.ok) {
      return NextResponse.json({ suggestions: [] });
    }
    const data = (await res.json()) as CensusResponse;
    const suggestions = Array.from(
      new Set(
        (data.result?.addressMatches ?? [])
          .map((m) => m.matchedAddress)
          .filter((a): a is string => Boolean(a))
          .map(prettyAddress),
      ),
    );
    return NextResponse.json({ suggestions });
  } catch {
    return NextResponse.json({ suggestions: [] });
  }
}
