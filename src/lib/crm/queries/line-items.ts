// Server-only CRM data access: quote line items (options and packages). Re-exported from ../queries.ts.
import {
  MAX_QUOTE_OPTIONS,
  MAX_QUOTE_PACKAGES,
  OPTION_DESC_MAX,
  OPTION_TITLE_MAX,
  PACKAGE_DESC_MAX,
  PACKAGE_TITLE_MAX,
  noEmDash,
  type QuoteOptionDraft,
  type QuotePackageDraft,
} from "../constants";
import { pgUser, pgAdmin } from "../rest";
import type { QuoteOption, QuotePackage, Session } from "../types";

// ── Quote line items ────────────────────────────────────────────────────────
// A quote has none (single price) or several, each answered separately.

export async function listQuoteOptions(session: Session, quoteId: string): Promise<QuoteOption[]> {
  const res = await pgUser(
    `quote_options?quote_id=eq.${encodeURIComponent(quoteId)}&select=*&order=sort_order.asc,created_at.asc`,
    session.accessToken,
  );
  // Any failure reads as "no line items", which is right for every caller.
  if (!res.ok) {
    console.error("[quoteOptions] list failed", { quoteId, status: res.status });
    return [];
  }
  return (await res.json()) as QuoteOption[];
}

// Service-role version for the customer's quote page and its endpoint (no session).
export async function listQuoteOptionsAdmin(quoteId: string): Promise<QuoteOption[]> {
  const res = await pgAdmin(
    `quote_options?quote_id=eq.${encodeURIComponent(quoteId)}&select=*&order=sort_order.asc,created_at.asc`,
  );
  if (!res.ok) {
    console.error("[quoteOptions] list failed", { quoteId, status: res.status });
    return [];
  }
  return (await res.json()) as QuoteOption[];
}

// Both editors post this JSON and neither is trusted: caps are enforced here as
// well as by the check constraint.
export function parseQuoteOptions(raw: unknown): { rows: QuoteOptionDraft[]; error?: string } {
  if (!Array.isArray(raw)) return { rows: [] };
  const rows: QuoteOptionDraft[] = [];
  for (const item of raw.slice(0, MAX_QUOTE_OPTIONS)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const title = noEmDash(String(o.title ?? "").trim()).slice(0, OPTION_TITLE_MAX);
    // A blank row is an abandoned add; drop it rather than refuse.
    if (!title) continue;
    const amount = Number(o.amount);
    if (!Number.isFinite(amount) || amount < 0 || amount > 99_999_999) {
      return { rows: [], error: `Enter a valid price for "${title}".` };
    }
    const id = typeof o.id === "string" && /^[0-9a-f-]{36}$/i.test(o.id) ? o.id : undefined;
    rows.push({
      id,
      title,
      description: noEmDash(String(o.description ?? "").trim()).slice(0, OPTION_DESC_MAX),
      amount: Math.round(amount * 100) / 100,
      required: o.required === true,
    });
  }
  return { rows };
}

// Same line items as the customer would read them; separates a correction from
// a resend of the same quote.
export function sameOptions(a: QuoteOptionDraft[], b: QuoteOptionDraft[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b[i];
    return (
      x.title === y.title &&
      x.description === y.description &&
      Number(x.amount) === Number(y.amount) &&
      x.required === y.required
    );
  });
}

// Stored rows in parseQuoteOptions' shape, for comparison.
export function optionsAsDrafts(rows: QuoteOption[]): QuoteOptionDraft[] {
  return rows.map((o) => ({
    id: o.id,
    title: o.title,
    description: o.description ?? "",
    amount: Number(o.amount),
    required: o.required,
  }));
}

// Sync stored line items to the submission. Rows keep their id (and the
// customer's answer). Runs as the user, so RLS stops edits to others' jobs.
export async function saveQuoteOptions(
  session: Session,
  quoteId: string,
  rows: QuoteOptionDraft[],
): Promise<{ ok: boolean; error?: string }> {
  const existing = await listQuoteOptions(session, quoteId);
  const byId = new Map(existing.map((o) => [o.id, o]));
  const keep = new Set(rows.map((r) => r.id).filter((id): id is string => Boolean(id && byId.has(id))));

  const gone = existing.filter((o) => !keep.has(o.id)).map((o) => o.id);
  if (gone.length > 0) {
    const res = await pgUser(`quote_options?id=in.(${gone.join(",")})`, session.accessToken, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
    if (!res.ok) return { ok: false, error: await optionError(res, "remove") };
  }

  const inserts: Record<string, unknown>[] = [];
  for (const [i, r] of rows.entries()) {
    const current = r.id ? byId.get(r.id) : undefined;
    const body = {
      title: r.title,
      description: r.description || null,
      amount: r.amount,
      required: r.required,
      sort_order: i,
    };
    if (!current) {
      inserts.push({ quote_id: quoteId, ...body });
      continue;
    }
    const unchanged =
      current.title === body.title &&
      (current.description ?? null) === body.description &&
      Number(current.amount) === body.amount &&
      current.required === body.required &&
      current.sort_order === i;
    if (unchanged) continue;
    const res = await pgUser(`quote_options?id=eq.${current.id}`, session.accessToken, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { ok: false, error: await optionError(res, "save") };
  }

  if (inserts.length > 0) {
    const res = await pgUser("quote_options", session.accessToken, {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(inserts),
    });
    if (!res.ok) return { ok: false, error: await optionError(res, "save") };
  }

  return { ok: true };
}

async function optionError(res: Response, verb: string): Promise<string> {
  const body = await res.text().catch(() => "");
  console.error("[quoteOptions] failed", { status: res.status, body });
  return `Could not ${verb} the line items (error ${res.status}). Please try again.`;
}

// ── Packages: pick exactly one ──────────────────────────────────────────────
// "Or instead" to line items' "and also" (concrete vs asphalt). Mirrors the
// line-item block deliberately: same scoping and error handling.

export async function listQuotePackages(session: Session, quoteId: string): Promise<QuotePackage[]> {
  const res = await pgUser(
    `quote_packages?quote_id=eq.${encodeURIComponent(quoteId)}&select=*&order=sort_order.asc,created_at.asc`,
    session.accessToken,
  );
  // Any failure reads as "no choice offered", which is right for every caller.
  if (!res.ok) {
    console.error("[quotePackages] list failed", { quoteId, status: res.status });
    return [];
  }
  return (await res.json()) as QuotePackage[];
}

// Service-role version for the customer's quote page and its endpoint (no session).
export async function listQuotePackagesAdmin(quoteId: string): Promise<QuotePackage[]> {
  const res = await pgAdmin(
    `quote_packages?quote_id=eq.${encodeURIComponent(quoteId)}&select=*&order=sort_order.asc,created_at.asc`,
  );
  if (!res.ok) {
    console.error("[quotePackages] list failed", { quoteId, status: res.status });
    return [];
  }
  return (await res.json()) as QuotePackage[];
}

// Same rules as parseQuoteOptions, plus: at most one recommended. The DB's
// partial unique index enforces it too; later ones just lose the flag so the
// browser gets a sentence, not a constraint error.
export function parseQuotePackages(raw: unknown): { rows: QuotePackageDraft[]; error?: string } {
  if (!Array.isArray(raw)) return { rows: [] };
  const rows: QuotePackageDraft[] = [];
  let recommended = false;
  for (const item of raw.slice(0, MAX_QUOTE_PACKAGES)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const title = noEmDash(String(o.title ?? "").trim()).slice(0, PACKAGE_TITLE_MAX);
    // A blank card is an abandoned add; drop it rather than refuse.
    if (!title) continue;
    const amount = Number(o.amount);
    if (!Number.isFinite(amount) || amount < 0 || amount > 99_999_999) {
      return { rows: [], error: `Enter a price for "${title}".` };
    }
    const id = typeof o.id === "string" && /^[0-9a-f-]{36}$/i.test(o.id) ? o.id : undefined;
    const isRec = o.recommended === true && !recommended;
    if (isRec) recommended = true;
    rows.push({
      id,
      title,
      description: noEmDash(String(o.description ?? "").trim()).slice(0, PACKAGE_DESC_MAX),
      amount: Math.round(amount * 100) / 100,
      recommended: isRec,
    });
  }
  // A lone card is kept so a half-typed choice isn't lost on save. It's inert
  // until there's a second: isChoice() gates pricing, the customer page and send.
  return { rows };
}

// Same choice as the customer would read it; separates a correction from a
// resend of the same quote.
export function samePackages(a: QuotePackageDraft[], b: QuotePackageDraft[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b[i];
    return (
      x.title === y.title &&
      x.description === y.description &&
      Number(x.amount) === Number(y.amount) &&
      x.recommended === y.recommended
    );
  });
}

// Stored rows in parseQuotePackages' shape, for comparison.
export function packagesAsDrafts(rows: QuotePackage[]): QuotePackageDraft[] {
  return rows.map((p) => ({
    id: p.id,
    title: p.title,
    description: p.description ?? "",
    amount: Number(p.amount),
    recommended: p.recommended,
  }));
}

// Sync stored packages to the submission. Rows keep their id (and the
// customer's answer). Runs as the user, so RLS stops edits to others' jobs.
export async function saveQuotePackages(
  session: Session,
  quoteId: string,
  rows: QuotePackageDraft[],
): Promise<{ ok: boolean; error?: string }> {
  const existing = await listQuotePackages(session, quoteId);
  const byId = new Map(existing.map((p) => [p.id, p]));
  const keep = new Set(rows.map((r) => r.id).filter((id): id is string => Boolean(id && byId.has(id))));

  const gone = existing.filter((p) => !keep.has(p.id)).map((p) => p.id);
  if (gone.length > 0) {
    const res = await pgUser(`quote_packages?id=in.(${gone.join(",")})`, session.accessToken, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
    if (!res.ok) return { ok: false, error: await packageError(res, "remove") };
  }

  // Clear recommendations first: the partial unique index allows one per
  // quote, so moving the flag would otherwise collide.
  const stillRecommended = existing.filter((p) => p.recommended && keep.has(p.id)).map((p) => p.id);
  if (stillRecommended.length > 0) {
    await pgUser(`quote_packages?id=in.(${stillRecommended.join(",")})`, session.accessToken, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ recommended: false }),
    });
  }

  const inserts: Record<string, unknown>[] = [];
  for (const [i, r] of rows.entries()) {
    const current = r.id ? byId.get(r.id) : undefined;
    const body = {
      title: r.title,
      description: r.description || null,
      amount: r.amount,
      recommended: r.recommended,
      sort_order: i,
    };
    if (!current) {
      inserts.push({ quote_id: quoteId, ...body });
      continue;
    }
    const res = await pgUser(`quote_packages?id=eq.${current.id}`, session.accessToken, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { ok: false, error: await packageError(res, "save") };
  }

  if (inserts.length > 0) {
    const res = await pgUser("quote_packages", session.accessToken, {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(inserts),
    });
    if (!res.ok) return { ok: false, error: await packageError(res, "save") };
  }

  return { ok: true };
}

async function packageError(res: Response, verb: string): Promise<string> {
  const body = await res.text().catch(() => "");
  console.error("[quotePackages] failed", { status: res.status, body });
  return `Could not ${verb} the options (error ${res.status}). Please try again.`;
}
