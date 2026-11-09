// The preview card a crew job link shows in a text thread (iMessage and other apps fetch it without signing in).
// It shows only the customer's initials and the job type, so threads full of job links can be told apart without
// putting a customer's name or address in front of anyone who isn't signed in. Pure, so it's unit-tested.

// The crew job link's token: 32 lowercase hex characters (quote_requests.job_token).
export const JOB_TOKEN = /^[0-9a-f]{32}$/;

// "Martha Flanagan" -> "MF"; "salil pant" -> "SP"; "Cher" -> "C"; "Mary Ann de la Cruz" -> "MC" (first and last).
export function initialsOf(name: string | null | undefined): string {
  const words = (name ?? "")
    .normalize("NFKC")
    .replace(/[^\p{L}\s'-]/gu, " ")
    .split(/\s+/)
    .filter((w) => /\p{L}/u.test(w));
  if (words.length === 0) return "?";
  const first = [...words[0]].find((c) => /\p{L}/u.test(c)) ?? "";
  if (words.length === 1) return first.toUpperCase();
  const lastWord = words[words.length - 1];
  const last = [...lastWord].find((c) => /\p{L}/u.test(c)) ?? "";
  return (first + last).toUpperCase();
}

// "Front/Back Porch" stays; empty becomes "Job". Capped so it fits the card.
export function serviceLabel(service: string | null | undefined): string {
  const s = (service ?? "").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, 32) : "Job";
}

// A steady colour per job, so the same job always looks the same and neighbours differ.
const COLOURS = ["#c2682a", "#2f6f8f", "#4f7a3a", "#8a4f9e", "#b4472f", "#3d6b6b", "#9a7b1c", "#5b5fa8"] as const;

export function colourFor(token: string): string {
  let h = 0;
  for (const c of token) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLOURS[h % COLOURS.length];
}

export function previewTitle(name: string | null | undefined, service: string | null | undefined): string {
  return `${initialsOf(name)} · ${serviceLabel(service)}`;
}

// The HTML a link-preview fetcher reads. A person who opens it is sent straight on to sign in (then the job).
export function previewHtml(i: { title: string; imageUrl: string; next: string }): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const login = `/crm/login?next=${encodeURIComponent(i.next)}`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(i.title)}</title>
<meta name="robots" content="noindex, nofollow">
<meta property="og:title" content="${esc(i.title)}">
<meta property="og:description" content="Raleigh Concrete Group job. Sign in to open it.">
<meta property="og:site_name" content="Raleigh Concrete Group">
<meta property="og:type" content="website">
<meta property="og:image" content="${esc(i.imageUrl)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(i.title)}">
<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0;url=${esc(login)}">
</head><body><p><a href="${esc(login)}">Sign in to open this job</a></p></body></html>`;
}
