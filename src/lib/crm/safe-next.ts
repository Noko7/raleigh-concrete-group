// Where the sign-in page may send someone afterwards: a path on this site only. Browsers read a backslash as "/"
// and drop tabs and newlines in URLs, so "/\evil.com" or "/<tab>/evil.com" would leave the site. Those are
// refused along with anything that isn't a plain same-site path.
export function safeNext(next: unknown): string | undefined {
  // A repeated ?next= arrives as an array: not a path.
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//")) return undefined;
  if (/[\\\u0000-\u001f\u007f]/.test(next)) return undefined;
  try {
    const u = new URL(next, "https://same.invalid");
    if (u.host !== "same.invalid") return undefined;
  } catch {
    return undefined;
  }
  return next;
}
