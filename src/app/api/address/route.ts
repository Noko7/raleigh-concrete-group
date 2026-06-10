import { NextResponse } from "next/server";

// Free US address autocomplete via the US Census Geocoder (authoritative TIGER
// data, house-number level). No API key, no billing. We proxy it server-side
// because the Census endpoint doesn't send CORS headers for browser fetches.

type CensusMatch = { matchedAddress?: string };
type CensusResponse = { result?: { addressMatches?: CensusMatch[] } };

// Keep proper capitalization: title-case words but leave 2-letter state codes
// and 5-digit ZIPs alone.
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

  // Census needs a fairly complete address to match; skip tiny queries.
  if (q.length < 6) {
    return NextResponse.json({ suggestions: [] });
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
