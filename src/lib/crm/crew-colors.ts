// Who is going, at a glance.
//
// The calendar already spends its colour on WHAT an appointment is - green for
// a booked work day, amber for a quote visit, dashed blue for a slot nobody has
// agreed to. That channel is taken, so "who is going" gets its own: a small
// round badge with the person's initials, tinted with a colour that is theirs.
//
// The initials are the identity and the colour is the accelerator. That order
// matters: a colour alone is unreadable until you have learnt the legend, and a
// roster change can move one, whereas MR has meant Marcus Reed since the day he
// was added. So nothing here ever shows a colour without the initials next to
// it.
//
// Safe to import from client components: pure functions, no env, no secrets.

// Hues that hold up on the dark CRM and against the chip fills they sit on.
//
// Deliberately no green and no amber: those are what the calendar already uses
// for "work day" and "quote visit", and a green badge on a green chip reads as
// one more thing about the job rather than a person.
//
// ORDER IS THE POINT. Colours are handed out from the top of this list, so the
// first few have to be the ones nobody could confuse - roughly 90 degrees apart
// on the wheel. A crew of four is the realistic case here and they get sky,
// rose, violet, orange, which are as far apart as this palette can put them.
// Everything after that is filling in the gaps, and by then the initials are
// doing most of the work anyway.
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

// Nobody assigned. Grey on purpose: it is the absence of a person, and the one
// state on this calendar that is a question rather than an answer.
export const UNASSIGNED_COLOR = "#6b7280";

/**
 * A colour per staff id, taken from the top of the palette.
 *
 * Ordered by id, so the mapping is the same on every device and every reload
 * with nothing stored. Ids rather than names because an id never changes and a
 * name does: a contractor fixing the spelling of their own name should not
 * repaint somebody else's week.
 *
 * The tradeoff, stated plainly: hiring somebody whose id sorts early shifts the
 * colours of people after them. That is the price of guaranteeing the crew you
 * have today gets the four most distinguishable hues rather than four hashes
 * that might land next to each other. Nobody is identified by colour alone -
 * the initials beside it are what survive a reshuffle - and a new contractor is
 * a rare day, whereas telling two people apart is every day.
 *
 * More people than colours and it wraps and starts sharing. The initials are
 * what stop that being ambiguous.
 */
export function crewColors(ids: string[]): Map<string, string> {
  const out = new Map<string, string>();
  [...new Set(ids)].sort().forEach((id, i) => out.set(id, CREW_COLORS[i % CREW_COLORS.length]));
  return out;
}

/**
 * "Marcus Reed" -> "MR", "Ana" -> "AN", "" -> "?".
 *
 * Two letters, because one is not enough to tell a Marcus from a Mike on a crew
 * where everybody's name starts the same. A single-word name gives up its first
 * two letters rather than showing one lonely capital.
 */
export function initials(name?: string | null): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** The first name, which is what the office calls people. */
export function shortName(name?: string | null): string {
  const first = (name ?? "").trim().split(/\s+/)[0];
  return first || "";
}
