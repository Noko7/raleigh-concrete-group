// Who is going, at a glance. Calendar colour already means WHAT (green work
// day, amber visit, dashed blue unagreed slot), so people get an initials badge
// tinted with their own colour. Initials are the identity, colour the
// accelerator: colours need a legend and can shift, so never show one without
// initials. Pure; safe for client components.
//
// No green or amber (taken by the calendar). ORDER MATTERS: colours are handed
// out from the top, so the first four (a realistic crew) are roughly 90 degrees
// apart.
import { firstNameOf } from "./constants";

export const CREW_COLORS = [
  "#0ea5e9", // sky
  "#e11d48", // rose
  "#8b5cf6", // violet
  "#f97316", // orange
  "#14b8a6", // teal
  "#d946ef", // fuchsia
  "#6366f1", // indigo
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#a855f7", // purple
] as const;

// Nobody assigned: grey, the absence of a person.
export const UNASSIGNED_COLOR = "#6b7280";

/**
 * A colour per staff id, from the top of the palette. Sorted by id so it's
 * stable across devices with nothing stored; ids because names get edited.
 * Tradeoff: a new hire whose id sorts early shifts later colours, the price of
 * giving today's crew the most distinct hues. Wraps past the palette; the
 * initials disambiguate.
 */
export function crewColors(ids: string[]): Map<string, string> {
  const out = new Map<string, string>();
  [...new Set(ids)].sort().forEach((id, i) => out.set(id, CREW_COLORS[i % CREW_COLORS.length]));
  return out;
}

/**
 * "Marcus Reed" -> "MR", "Ana" -> "AN", "" -> "?".
 *
 * Two letters, since one can't tell a Marcus from a Mike; a single-word name
 * gives its first two letters.
 */
export function initials(name?: string | null): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** The first name, which is what the office calls people. */
export function shortName(name?: string | null): string {
  return firstNameOf(name ?? "", "");
}
