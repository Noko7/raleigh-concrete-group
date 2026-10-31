// The customer agreement as data: blocks of text plus the job's values, rendered to one HTML document. Pure (no
// network, no Node APIs), so the editor's live preview in the browser and the copy sent for signing are produced
// by the same function from the same saved version, and the wording, the draft and the diff between versions are
// tested (agreement-doc.test.ts).
//
// Clause text comes from a template (document_templates, edited by the owner in the Documents hub; see
// templates.ts). An agreement carries a snapshot of the template version it was drafted from, so its optional
// clauses, required clauses, titles and "standard wording" never change when the template is edited later, and a
// sent version is never re-rendered: its HTML is frozen when it is saved (agreement-versions.ts).
// BUILTIN_STANDARD is the Drive master as code: the default when no template is chosen, and the seed of the
// "Standard Work Agreement" template. AGREEMENT_TEMPLATE_VERSION versions the document format itself.

import { DEFAULT_DEPOSIT_PERCENT } from "./fees.ts";

export const AGREEMENT_TEMPLATE_VERSION = "2026-10-31.1";

export const OFFICE = {
  name: "Raleigh Concrete Group",
  phone: "(919) 873-3919",
  email: "info@raleighconcrete.net",
  website: "www.raleighconcrete.net",
} as const;

export const PAYMENT_METHODS = ["zelle", "venmo", "check", "cash"] as const;
export type PayMethod = (typeof PAYMENT_METHODS)[number];
const METHOD_NAMES: Record<PayMethod, string> = { zelle: "Zelle", venmo: "Venmo", check: "Check", cash: "Cash" };

export type TaxMode = "plus_tax" | "includes_tax";

/** Everything on the agreement that isn't clause text. Money is read from the job and never typed here. */
export type AgreementValues = {
  date: string; // YYYY-MM-DD, the day it is sent
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  job_address: string;
  contractor_name: string;
  contractor_license: string;
  contractor_phone: string;
  total_cents: number;
  deposit_cents: number;
  tax_mode: TaxMode;
  payment_methods: PayMethod[];
  /** Set on an amended agreement: the date the agreement it replaces was signed (YYYY-MM-DD). */
  replaces_signed_on: string | null;
};

export type BlockKind = "work" | "clause" | "initials" | "custom";
export type BlockOrigin = "quote" | "template" | "custom";

export type AgreementBlock = {
  /** Stable across versions, so a diff lines blocks up: "work.scope", "clause.warranty", "custom.3". */
  id: string;
  kind: BlockKind;
  title: string;
  /** Plain text. Blank line = new paragraph; a line starting "- " is a bullet; **bold** is bold. */
  text: string;
  origin: BlockOrigin;
  /** The text this block started from (the quote's section or the template clause), to flag edits. */
  base: string | null;
};

/** One clause of a template. `text_includes_tax`, when set, replaces `text` while the tax wording is "includes". */
export type TemplateClause = {
  id: string;
  kind: "clause" | "initials";
  title: string;
  text: string;
  text_includes_tax: string | null;
  optional: boolean;
  /** For an optional clause: switched on in a new draft. */
  on_by_default: boolean;
};

/** What a template version holds (document_template_versions.body). */
export type TemplateBody = { tax_mode: TaxMode; clauses: TemplateClause[] };

/** The template an agreement was drafted from, as it was then. id null = the built-in standard (no saved template). */
export type TemplateSnapshot = TemplateBody & { id: string | null; version_no: number | null; name: string };

export type AgreementBody = {
  template_version: string;
  template: TemplateSnapshot;
  values: AgreementValues;
  blocks: AgreementBlock[];
};

// ── Template v2026-10-31.1: the Drive master, plus the optional clauses from the Alexavier amendment ──────

const WORK_SECTIONS: { id: string; title: string; quoteField: string | null }[] = [
  { id: "work.scope", title: "Scope", quoteField: "quote_scope" },
  { id: "work.permits", title: "Permits", quoteField: "quote_permits" },
  { id: "work.prep", title: "Demolition and Prep", quoteField: "quote_prep" },
  { id: "work.pour", title: "Pour and Finish", quoteField: "quote_pour" },
  { id: "work.cleanup", title: "Clean Up", quoteField: "quote_cleanup" },
  { id: "work.duration", title: "Estimated Duration", quoteField: "estimated_duration" },
];

export const WORK_NOTE =
  "Dimensions, thickness, mix/PSI, finish, and base prep. Only what's written here is included; anything else needs a signed change order.";

const PRICE_NOTE: Record<TaxMode, string> = {
  plus_tax:
    "Your payment goes directly to the Contractor. Estimates are free. Final price is confirmed on site; any changes are put in writing and signed before that work is done.",
  includes_tax:
    "The total price is the full amount owed for the work described and includes all applicable sales tax and fees. No other charges will be added unless you approve them in a signed change order before that work is done. Your payment goes directly to the Contractor.",
};

const TAX_WORDS: Record<TaxMode, string> = {
  plus_tax: "(plus tax & any permit fees)",
  includes_tax: "(includes all sales tax and fees)",
};

type ClauseDef = { id: string; kind: "clause" | "initials"; title: string; text: string; optional: boolean };

const STANDARD_CLAUSES: ClauseDef[] = [
  {
    id: "clause.basics",
    kind: "clause",
    title: "Please Read — Concrete Basics",
    optional: false,
    text: [
      "- **Concrete cracks.** Hairline and shrinkage cracks, and cracking from ground movement, are normal and not a defect. Joints direct cracking but don't prevent it.",
      "- **Color, finish, and surface variation** (including efflorescence, the white haze) are normal.",
      "- **Stay off** new concrete for 24 hours; keep vehicles off for 7 days, heavy vehicles 28 days. Damage from early use is the customer's responsibility.",
      "- **We call 811** for public utilities. You must mark private lines (sprinklers, pet fence, lighting, private water/gas). Unmarked private lines aren't our responsibility.",
      "- **You confirm** that you own the property (or may authorize the work) and that it meets any HOA / setback rules.",
    ].join("\n"),
  },
  {
    id: "clause.repair",
    kind: "initials",
    title: "Repair Limitations - Please Initial Each",
    optional: true,
    text: [
      "This is a repair to existing concrete, not a replacement. Please read and initial each item.",
      "",
      "- **Color and texture will not match.** Repair material comes from a different batch than the original concrete and will not match its color, shade, or texture exactly. Repaired areas will be visible and may weather differently over time. A color or texture difference is not a defect and is not a reason to withhold payment or to redo the work.",
      "- **Only the listed areas are repaired.** This job covers only the chips and cracks identified at the time of the estimate. The rest of the slab, adjacent concrete, and any areas not pointed out are not included or warranted.",
      "- **Existing conditions are not fixed.** The repair is cosmetic, not structural. It does not correct the causes of the damage, such as settlement, poor base, soil movement, tree roots, drainage, or freeze-thaw. Existing cracks may reopen or spread, and new cracks may form.",
      "- **No responsibility for future repairs.** Neither the Contractor nor Raleigh Concrete Group is responsible for any further repair, replacement, or resurfacing of this slab after this job, except as stated in the Warranty below.",
    ].join("\n"),
  },
  {
    id: "clause.warranty",
    kind: "clause",
    title: "Warranty",
    optional: false,
    text: "The Contractor warrants workmanship for one (1) year from completion. This does not cover the normal concrete characteristics above, ground movement, misuse, de-icing salt, or lack of maintenance. Repair or replacement of faulty workmanship is the only remedy. Warranty and any claims are handled by the Contractor.",
  },
  {
    id: "clause.responsible",
    kind: "clause",
    title: "Who's Responsible",
    optional: false,
    text: "The Contractor is the party you're hiring and is responsible for the work, warranty, permits, and any claims. Raleigh Concrete Group is not the contractor, does not perform or warrant the work, and does not receive or hold your payment.",
  },
  {
    id: "clause.insurance",
    kind: "clause",
    title: "Insurance",
    optional: true,
    text: "The Contractor carries general liability insurance and will provide a certificate of insurance on request.\n\nRaleigh Concrete Group books the job only. It does not perform the work and does not carry insurance for it.",
  },
  {
    id: "clause.liability",
    kind: "clause",
    title: "Limitation of Liability",
    optional: true,
    text: "The Contractor's total liability for any claim related to this work is limited to the amount paid under this agreement. Neither the Contractor nor Raleigh Concrete Group is liable for indirect or consequential damages, such as loss of use or damage resulting from existing conditions. This does not limit liability for bodily injury or property damage caused by the Contractor's negligence, which is covered by the Contractor's insurance.",
  },
  {
    id: "clause.cancel",
    kind: "clause",
    title: "Your Right to Cancel",
    optional: false,
    text: "If you signed this at your home, you may cancel within 3 business days by written notice to Raleigh Concrete Group at the contact above. Any deposit is refunded within 10 days.",
  },
  {
    id: "clause.authorization",
    kind: "clause",
    title: "Authorization",
    optional: false,
    text: "I authorize the Contractor to perform the work described above at the price shown. I have read the concrete basics, warranty, and cancellation terms.",
  },
];

const AUTH_INCLUDES_TAX =
  "I authorize the Contractor to perform the work described above for the total price shown, which includes all taxes and fees. I have read and understand the terms above.";
const AMENDED_SENTENCE =
  " This amended agreement replaces the version signed earlier and is our complete agreement. Any change must be in writing and signed by both parties.";

/** The Drive master with the Alexavier amendment's clauses as options: the default, and the Standard template's seed. */
export const BUILTIN_STANDARD: TemplateSnapshot = {
  id: null,
  version_no: null,
  name: "Standard Work Agreement",
  tax_mode: "plus_tax",
  clauses: STANDARD_CLAUSES.map((c) => ({
    ...c,
    text_includes_tax: c.id === "clause.authorization" ? AUTH_INCLUDES_TAX : null,
    on_by_default: false,
  })),
};

const clauseIn = (t: TemplateBody, id: string) => t.clauses.find((c) => c.id === id) ?? null;
export const optionalClauseIds = (t: TemplateBody) => t.clauses.filter((c) => c.optional).map((c) => c.id);
const requiredClauseIds = (t: TemplateBody) => t.clauses.filter((c) => !c.optional).map((c) => c.id);
const WORK_IDS = WORK_SECTIONS.map((w) => w.id);

// ── Drafting from a job ─────────────────────────────────────────────────────

export type DraftInput = {
  today: string;
  quote: {
    name: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    city: string | null;
    quote_scope: string | null;
    quote_permits: string | null;
    quote_prep: string | null;
    quote_pour: string | null;
    quote_cleanup: string | null;
    estimated_duration: string | null;
  };
  /** The lines the customer took (options, package, extras), printed under Scope. */
  boughtLines: string[];
  contractor: {
    full_name: string | null;
    business_name: string | null;
    license_number: string | null;
    phone: string | null;
    payment_methods: string[] | null;
  } | null;
  totalCents: number;
  depositCents: number;
  /** The template to draft from; the built-in standard when left out. */
  template?: TemplateSnapshot;
  /** Defaults to the template's. */
  taxMode?: TaxMode;
  /** Optional clauses to switch on; defaults to the template's "on by default" ones. */
  optionalClauses?: string[];
  replacesSignedOn: string | null;
};

const tidy = (s: string | null | undefined) => (s ?? "").replace(/\r\n?/g, "\n").trim();

export function prettyPhone(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  const m = /^\+?1?(\d{3})(\d{3})(\d{4})$/.exec(s.replace(/[^\d+]/g, ""));
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : s;
}

export function draftAgreement(input: DraftInput): AgreementBody {
  const template = input.template ?? BUILTIN_STANDARD;
  const q = input.quote;
  const c = input.contractor;
  const methods = (c?.payment_methods ?? [...PAYMENT_METHODS]).filter((m): m is PayMethod =>
    (PAYMENT_METHODS as readonly string[]).includes(m),
  );
  const values: AgreementValues = {
    date: input.today,
    customer_name: tidy(q.name),
    customer_phone: prettyPhone(q.phone),
    customer_email: tidy(q.email),
    job_address: [tidy(q.address), tidy(q.city)].filter(Boolean).join(", "),
    contractor_name: tidy(c?.business_name) || tidy(c?.full_name),
    contractor_license: tidy(c?.license_number),
    contractor_phone: prettyPhone(c?.phone),
    total_cents: Math.round(input.totalCents),
    deposit_cents: Math.round(input.depositCents),
    tax_mode: input.taxMode ?? template.tax_mode,
    payment_methods: methods.length ? methods : [...PAYMENT_METHODS],
    replaces_signed_on: input.replacesSignedOn,
  };

  const blocks: AgreementBlock[] = WORK_SECTIONS.map((w) => {
    let text = tidy((q as Record<string, string | null>)[w.quoteField ?? ""]);
    if (w.id === "work.scope" && input.boughtLines.length) {
      const lines = input.boughtLines.map((l) => `- ${tidy(l)}`).join("\n");
      text = text ? `${text}\n\n${lines}` : lines;
    }
    return { id: w.id, kind: "work" as const, title: w.title, text, origin: "quote" as const, base: text };
  });
  const on = input.optionalClauses ?? template.clauses.filter((c) => c.optional && c.on_by_default).map((c) => c.id);
  for (const cl of template.clauses) {
    if (cl.optional && !on.includes(cl.id)) continue;
    blocks.push(clauseBlock(template, cl.id, values));
  }
  return { template_version: AGREEMENT_TEMPLATE_VERSION, template, values, blocks };
}

/**
 * A template clause as a block: its "includes tax" wording when the agreement says so, and the amended-agreement
 * sentence on Authorization when it replaces a signed one.
 */
export function clauseBlock(template: TemplateBody, id: string, values: Pick<AgreementValues, "replaces_signed_on" | "tax_mode">): AgreementBlock {
  const cl = clauseIn(template, id);
  if (!cl) throw new Error(`Unknown clause ${id}`);
  let text = values.tax_mode === "includes_tax" && cl.text_includes_tax ? cl.text_includes_tax : cl.text;
  if (id === "clause.authorization" && values.replaces_signed_on) text += AMENDED_SENTENCE;
  return { id, kind: cl.kind, title: cl.title, text, origin: "template", base: text };
}

/** Switch an optional clause on or off, keeping template order. Required clauses can't be removed. */
export function toggleClause(body: AgreementBody, id: string, on: boolean): AgreementBody {
  if (!optionalClauseIds(body.template).includes(id)) return body;
  const has = body.blocks.some((b) => b.id === id);
  if (on === has) return body;
  const blocks = on ? [...body.blocks, clauseBlock(body.template, id, body.values)] : body.blocks.filter((b) => b.id !== id);
  return { ...body, blocks: sortBlocks(blocks, body.template) };
}

export function addCustomBlock(body: AgreementBody, title: string, text: string): AgreementBody {
  const n = Math.max(0, ...body.blocks.filter((b) => b.kind === "custom").map((b) => Number(b.id.split(".")[1]) || 0)) + 1;
  const block: AgreementBlock = { id: `custom.${n}`, kind: "custom", title: tidy(title) || "Additional terms", text: tidy(text), origin: "custom", base: null };
  return { ...body, blocks: sortBlocks([...body.blocks, block], body.template) };
}

/** Work sections, then the template's clauses in its order; custom sections just before Authorization (or last). */
function sortBlocks(blocks: AgreementBlock[], template: TemplateBody): AgreementBlock[] {
  const order = [...WORK_IDS, ...template.clauses.map((c) => c.id)];
  const auth = order.indexOf("clause.authorization");
  const rank = (b: AgreementBlock) => {
    if (b.kind === "custom") return (auth < 0 ? order.length : auth) - 0.5 + Number(b.id.split(".")[1]) / 1e6;
    const i = order.indexOf(b.id);
    return i < 0 ? order.length : i;
  };
  return [...blocks].sort((a, b) => rank(a) - rank(b));
}

// ── Checks before a version can be saved or sent ────────────────────────────

export type Problem = { field: string; message: string };

/** What must be true for a version to go out for signing. Saving a draft only needs the structure to be valid. */
export function sendProblems(body: AgreementBody): Problem[] {
  const v = body.values;
  const out: Problem[] = [];
  const need = (field: keyof AgreementValues, label: string) => {
    if (!String(v[field] ?? "").trim()) out.push({ field, message: `${label} is missing.` });
  };
  need("customer_name", "Customer name");
  need("customer_phone", "Customer phone");
  need("job_address", "Job address");
  need("contractor_name", "Contractor");
  // No license # is fine: some contractors don't hold or need one for the work. The agreement then leaves it out.
  need("contractor_phone", "Contractor phone");
  if (!(v.total_cents > 0)) out.push({ field: "total_cents", message: "The job has no price yet." });
  if (v.deposit_cents < 0 || v.deposit_cents > v.total_cents) out.push({ field: "deposit_cents", message: "The deposit is more than the total." });
  for (const b of body.blocks) {
    if (b.kind !== "custom" && !b.text.trim()) out.push({ field: b.id, message: `${b.title} is empty. Write the work, or "N/A".` });
  }
  for (const id of requiredClauseIds(body.template)) {
    if (!body.blocks.some((b) => b.id === id)) out.push({ field: id, message: `${clauseIn(body.template, id)?.title} is required.` });
  }
  return out;
}

const ymdOk = (x: unknown): x is string => {
  if (typeof x !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x)) return false;
  const [y, m, d] = x.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d && y >= 2020 && y <= 2100;
};
const textOk = (x: unknown, max: number): x is string => typeof x === "string" && x.length <= max;
const MAX_CENTS = 99_999_999_99;

/** The kind a block id may have: work.* is work, custom.* is custom, clause.* is the template's clause of that id. */
function kindFor(id: string, template: TemplateBody): BlockKind | null {
  if (/^work\.(scope|permits|prep|pour|cleanup|duration)$/.test(id)) return "work";
  if (/^custom\.[1-9]\d{0,2}$/.test(id)) return "custom";
  const cl = clauseIn(template, id);
  return cl ? cl.kind : null;
}

export const CLAUSE_ID_RE = /^clause\.[a-z0-9_]{1,40}$/;

/**
 * Re-checks a template's clauses: ids clause.<slug> and unique, kinds and lengths, at most 30 clauses, and an
 * Authorization clause that is always required (it carries the agreement-replaces sentence and sits above the
 * signatures). Returns the rebuilt body, or why it can't be used.
 */
export function parseTemplateBody(raw: unknown): { ok: true; body: TemplateBody } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "The template couldn't be read." };
  const r = raw as Record<string, unknown>;
  if (r.tax_mode !== "plus_tax" && r.tax_mode !== "includes_tax") return { ok: false, error: "Pick the tax wording." };
  if (!Array.isArray(r.clauses) || r.clauses.length < 1 || r.clauses.length > 30) return { ok: false, error: "A template has 1 to 30 sections." };
  const ids = new Set<string>();
  const clauses: TemplateClause[] = [];
  for (const c of r.clauses as Record<string, unknown>[]) {
    if (!c || typeof c !== "object" || typeof c.id !== "string" || !CLAUSE_ID_RE.test(c.id) || ids.has(c.id)) return { ok: false, error: "A section's id is invalid or repeated." };
    if (c.kind !== "clause" && c.kind !== "initials") return { ok: false, error: "A section's type is invalid." };
    if (!textOk(c.title, 120) || !c.title.trim()) return { ok: false, error: "Every section needs a title (up to 120 characters)." };
    if (!textOk(c.text, 8000) || !c.text.trim()) return { ok: false, error: `"${c.title}" has no text.` };
    if (!(c.text_includes_tax === null || c.text_includes_tax === undefined || textOk(c.text_includes_tax, 8000))) {
      return { ok: false, error: `"${c.title}": the "includes tax" wording is too long.` };
    }
    if (typeof c.optional !== "boolean" || typeof c.on_by_default !== "boolean") return { ok: false, error: "A section's switches are invalid." };
    ids.add(c.id);
    const alt = typeof c.text_includes_tax === "string" && c.text_includes_tax.trim() ? c.text_includes_tax.replace(/\r\n?/g, "\n").trim() : null;
    clauses.push({
      id: c.id,
      kind: c.kind,
      title: c.title.trim(),
      text: c.text.replace(/\r\n?/g, "\n").trim(),
      text_includes_tax: alt,
      optional: c.optional,
      on_by_default: c.optional && c.on_by_default,
    });
  }
  const auth = clauses.find((c) => c.id === "clause.authorization");
  if (!auth) return { ok: false, error: "A template needs an Authorization section." };
  if (auth.optional || auth.kind !== "clause") return { ok: false, error: "Authorization must be a required, ordinary section." };
  return { ok: true, body: { tax_mode: r.tax_mode, clauses } };
}

/** A template snapshot inside a saved agreement. Missing (drafted before templates existed) = the built-in. */
export function parseSnapshot(raw: unknown): TemplateSnapshot | null {
  if (raw === undefined) return BUILTIN_STANDARD;
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const body = parseTemplateBody(r);
  if (!body.ok) return null;
  const id = r.id === null ? null : typeof r.id === "string" && /^[0-9a-fA-F-]{36}$/.test(r.id) ? r.id : undefined;
  const no = r.version_no === null ? null : Number.isInteger(r.version_no) && (r.version_no as number) >= 1 ? (r.version_no as number) : undefined;
  if (id === undefined || no === undefined || (id === null) !== (no === null) || !textOk(r.name, 120)) return null;
  return { ...body.body, id, version_no: no, name: (r.name as string).trim() || "Template" };
}

/**
 * Re-checks anything coming back from the browser and rebuilds it field by field, so a saved version is always
 * renderable and can't carry anything the editor couldn't have produced: unknown keys are dropped, block kinds
 * follow from their ids (initials only on Repair Limitations), dates are real dates, money is whole cents with
 * 0 <= deposit <= total. The server still replaces the money with the job's own figures before saving.
 */
export function parseBody(raw: unknown): AgreementBody | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  const v = b.values as Record<string, unknown> | undefined;
  if (typeof b.template_version !== "string" || !/^\d{4}-\d{2}-\d{2}\.\d{1,3}$/.test(b.template_version)) return null;
  if (!v || typeof v !== "object" || !Array.isArray(b.blocks) || b.blocks.length > 60) return null;
  const template = parseSnapshot(b.template);
  if (!template) return null;
  const total = v.total_cents;
  const deposit = v.deposit_cents;
  const methods = v.payment_methods;
  if (
    !ymdOk(v.date) ||
    !textOk(v.customer_name, 200) ||
    !textOk(v.customer_phone, 40) ||
    !textOk(v.customer_email, 200) ||
    !textOk(v.job_address, 300) ||
    !textOk(v.contractor_name, 200) ||
    !textOk(v.contractor_license, 60) ||
    !textOk(v.contractor_phone, 40) ||
    !Number.isInteger(total) || (total as number) < 0 || (total as number) > MAX_CENTS ||
    !Number.isInteger(deposit) || (deposit as number) < 0 || (deposit as number) > (total as number) ||
    (v.tax_mode !== "plus_tax" && v.tax_mode !== "includes_tax") ||
    !Array.isArray(methods) || methods.length < 1 || methods.length > 4 ||
    !methods.every((m) => (PAYMENT_METHODS as readonly unknown[]).includes(m)) ||
    !(v.replaces_signed_on === null || ymdOk(v.replaces_signed_on))
  ) {
    return null;
  }
  const values: AgreementValues = {
    date: v.date,
    customer_name: v.customer_name,
    customer_phone: v.customer_phone,
    customer_email: v.customer_email,
    job_address: v.job_address,
    contractor_name: v.contractor_name,
    contractor_license: v.contractor_license,
    contractor_phone: v.contractor_phone,
    total_cents: total as number,
    deposit_cents: deposit as number,
    tax_mode: v.tax_mode,
    payment_methods: PAYMENT_METHODS.filter((m) => (methods as unknown[]).includes(m)),
    replaces_signed_on: (v.replaces_signed_on as string | null) ?? null,
  };
  const ids = new Set<string>();
  const blocks: AgreementBlock[] = [];
  for (const k of b.blocks as Record<string, unknown>[]) {
    if (!k || typeof k !== "object" || typeof k.id !== "string" || ids.has(k.id)) return null;
    const kind = kindFor(k.id, template);
    const origin = kind === "work" ? "quote" : kind === "custom" ? "custom" : "template";
    if (!kind || k.kind !== kind || k.origin !== origin) return null;
    if (!textOk(k.title, 120) || !textOk(k.text, 8000) || !(k.base === null || textOk(k.base, 8000))) return null;
    // Template blocks keep their template titles; only custom sections are named by the editor.
    const title = kind === "custom" ? (k.title.trim() || "Additional terms") : kind === "work" ? WORK_SECTIONS.find((w) => w.id === k.id)!.title : clauseIn(template, k.id)!.title;
    ids.add(k.id);
    blocks.push({ id: k.id, kind, title, text: k.text.replace(/\r\n?/g, "\n"), origin, base: kind === "custom" ? null : (k.base as string | null) });
  }
  return { template_version: b.template_version, template, values, blocks: sortBlocks(blocks, template) };
}

/** Change the tax wording; clauses with tax-specific wording (Authorization) follow it unless someone rewrote them. */
export function setTaxMode(body: AgreementBody, mode: TaxMode): AgreementBody {
  const values = { ...body.values, tax_mode: mode };
  const blocks = body.blocks.map((b) => {
    const cl = b.kind === "clause" || b.kind === "initials" ? clauseIn(body.template, b.id) : null;
    if (!cl || !cl.text_includes_tax || (b.base !== null && b.text.trim() !== b.base.trim())) return b;
    return clauseBlock(body.template, b.id, values);
  });
  return { ...body, values, blocks };
}

// ── Rendering ───────────────────────────────────────────────────────────────

export function money(cents: number): string {
  const abs = Math.abs(Math.round(cents));
  return `${cents < 0 ? "-" : ""}$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}

export function longDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** **bold** only; everything else is literal text. */
const inline = (s: string) => esc(s).replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>");

/**
 * Paragraphs and bullet lists from plain text. With `initials`, each bullet gets the customer's initials field,
 * numbered from the counter passed in: one counter per document, so field names never repeat across sections.
 */
export function textToHtml(text: string, opts: { initials?: { n: number } } = {}): string {
  const out: string[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (!bullets.length) return;
    out.push(`<ul>${bullets.join("")}</ul>`);
    bullets = [];
  };
  for (const para of text.replace(/\r\n?/g, "\n").split(/\n{2,}/)) {
    for (const line of para.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      if (t.startsWith("- ")) {
        let li = inline(t.slice(2));
        if (opts.initials) {
          opts.initials.n += 1;
          li += ` <span class="ag-initials">Initials: <initials-field name="Initials ${opts.initials.n}" role="Customer" required="true" style="width: 70px; height: 28px; display: inline-block;"></initials-field></span>`;
        }
        bullets.push(`<li>${li}</li>`);
      } else {
        flush();
        out.push(`<p>${inline(t)}</p>`);
      }
    }
    flush();
  }
  return out.join("");
}

const SIGN_STYLE = "width: 220px; height: 54px; display: inline-block;";
const DATE_STYLE = "width: 130px; height: 24px; display: inline-block;";

/**
 * The agreement as one HTML document, as DocuSeal receives it and as the preview shows it. Signature, initials
 * and date fields are DocuSeal field tags (roles Contractor and Customer); the preview styles them as boxes.
 * Every value is escaped: nothing typed can add markup or fields.
 */
export function renderAgreementHtml(body: AgreementBody): string {
  const v = body.values;
  const blank = (s: string) => (s.trim() ? esc(s) : `<span class="ag-blank">&nbsp;</span>`);
  const work = body.blocks.filter((b) => b.kind === "work");
  const rest = body.blocks.filter((b) => b.kind !== "work");
  const balance = v.total_cents - v.deposit_cents;
  const methods = v.payment_methods.map((m) => METHOD_NAMES[m]).join(", ");

  const parts: string[] = [];
  parts.push(`<h1>Customer Agreement &amp; Work Authorization</h1>`);
  if (v.replaces_signed_on) {
    parts.push(`<p class="ag-amended"><strong>AMENDED AGREEMENT: replaces the version signed on ${esc(longDate(v.replaces_signed_on))}</strong></p>`);
  }
  parts.push(
    `<p class="ag-booked"><em>Booked by ${esc(OFFICE.name)}</em><br>${esc(OFFICE.phone)} · ${esc(OFFICE.email)} · ${esc(OFFICE.website)}</p>`,
    `<p class="ag-booked"><em>${esc(OFFICE.name)} books the job. The ${v.contractor_license.trim() ? "licensed " : ""}contractor named below performs and warrants the work, and is paid directly.</em></p>`,
    `<table class="ag-parties"><tbody>` +
      `<tr><th>Date</th><td colspan="3">${esc(longDate(v.date))}</td></tr>` +
      `<tr><th>Customer</th><td>${blank(v.customer_name)}</td><th>Phone</th><td>${blank(v.customer_phone)}</td></tr>` +
      `<tr><th>Job address</th><td colspan="3">${blank(v.job_address)}</td></tr>` +
      `<tr><th>Email</th><td colspan="3">${blank(v.customer_email)}</td></tr>` +
      `<tr><th>Contractor (performs &amp; warrants the work)</th><td colspan="3">${blank(v.contractor_name)}</td></tr>` +
      (v.contractor_license.trim()
        ? `<tr><th>Contractor license #</th><td>${esc(v.contractor_license)}</td><th>Contractor phone</th><td>${blank(v.contractor_phone)}</td></tr>`
        : `<tr><th>Contractor phone</th><td colspan="3">${blank(v.contractor_phone)}</td></tr>`) +
      `</tbody></table>`,
    `<h2>Work to Be Done</h2>`,
  );
  for (const b of work) parts.push(`<h3>${esc(b.title)}</h3>${b.text.trim() ? textToHtml(b.text) : "<p>N/A</p>"}`);
  parts.push(`<p class="ag-note"><em>${esc(WORK_NOTE)}</em></p>`);

  parts.push(
    `<h2>Price &amp; Payment</h2>`,
    `<table class="ag-price"><tbody>` +
      `<tr><th>Total price</th><td>${money(v.total_cents)} ${esc(TAX_WORDS[v.tax_mode])}</td></tr>` +
      `<tr><th>Deposit due to schedule</th><td>${money(v.deposit_cents)}</td></tr>` +
      `<tr><th>Balance due at completion</th><td>${money(balance)}</td></tr>` +
      `</tbody></table>`,
    `<p><strong>How you pay:</strong> ${esc(methods)}</p>`,
    `<p>${esc(PRICE_NOTE[v.tax_mode])}</p>`,
  );

  // One counter for the whole document: initials field names must be unique across every initialed section.
  const initials = { n: 0 };
  for (const b of rest) {
    const isInitials = b.kind === "initials";
    parts.push(`<h2>${esc(b.title)}</h2>${textToHtml(b.text, isInitials ? { initials } : {})}`);
  }

  parts.push(
    `<div class="ag-sign">` +
      `<p><strong>Customer signature:</strong> <signature-field name="Customer signature" role="Customer" required="true" style="${SIGN_STYLE}"></signature-field>` +
      ` <strong>Date:</strong> <date-field name="Customer date" role="Customer" required="true" style="${DATE_STYLE}"></date-field></p>` +
      `<p><strong>Contractor signature:</strong> <signature-field name="Contractor signature" role="Contractor" required="true" style="${SIGN_STYLE}"></signature-field>` +
      ` <strong>Date:</strong> <date-field name="Contractor date" role="Contractor" required="true" style="${DATE_STYLE}"></date-field></p>` +
      `</div>`,
  );

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${DOC_CSS}</style></head><body>${parts.join("")}</body></html>`;
}

export const DOC_CSS = [
  "body{font-family:Helvetica,Arial,sans-serif;font-size:11pt;line-height:1.4;color:#111}",
  "h1{font-size:17pt;margin:0 0 6pt;text-align:center}",
  "h2{font-size:13pt;margin:14pt 0 4pt;border-bottom:1px solid #999;padding-bottom:2pt}",
  "h3{font-size:11pt;margin:8pt 0 2pt}",
  "p{margin:0 0 5pt}",
  "ul{margin:0 0 6pt 16pt;padding:0}li{margin:0 0 4pt}",
  "table{border-collapse:collapse;width:100%;margin:4pt 0 8pt;table-layout:fixed}",
  "th,td{border:1px solid #bbb;padding:4pt 6pt;text-align:left;vertical-align:top;overflow-wrap:anywhere}",
  "th{background:#f3f3f3;font-weight:bold}",
  ".ag-parties th{width:19%}.ag-price th{width:40%}",
  ".ag-booked{text-align:center;font-size:9.5pt}",
  ".ag-amended{text-align:center}",
  ".ag-note{font-size:9.5pt}",
  ".ag-blank{display:inline-block;min-width:120pt;border-bottom:1px solid #111}",
  ".ag-initials{white-space:nowrap}",
  ".ag-sign{margin-top:16pt}.ag-sign p{margin:0 0 14pt}",
].join("");

// ── Version diff ────────────────────────────────────────────────────────────

export type WordOp = { op: "same" | "add" | "del"; text: string };
export type Change =
  | { kind: "value"; key: string; label: string; before: string; after: string }
  | { kind: "block"; id: string; title: string; change: "added" | "removed" | "edited"; words: WordOp[] };

const VALUE_LABELS: [keyof AgreementValues, string, (v: AgreementValues) => string][] = [
  ["date", "Date", (v) => longDate(v.date)],
  ["customer_name", "Customer", (v) => v.customer_name],
  ["customer_phone", "Customer phone", (v) => v.customer_phone],
  ["customer_email", "Customer email", (v) => v.customer_email],
  ["job_address", "Job address", (v) => v.job_address],
  ["contractor_name", "Contractor", (v) => v.contractor_name],
  ["contractor_license", "Contractor license #", (v) => v.contractor_license],
  ["contractor_phone", "Contractor phone", (v) => v.contractor_phone],
  ["total_cents", "Total price", (v) => money(v.total_cents)],
  ["deposit_cents", "Deposit", (v) => money(v.deposit_cents)],
  ["tax_mode", "Tax wording", (v) => TAX_WORDS[v.tax_mode]],
  ["payment_methods", "How you pay", (v) => v.payment_methods.map((m) => METHOD_NAMES[m]).join(", ")],
  ["replaces_signed_on", "Replaces agreement signed on", (v) => (v.replaces_signed_on ? longDate(v.replaces_signed_on) : "")],
];

/** Word-level diff (LCS). Agreement blocks are a few hundred words, so the quadratic table is fine. */
export function diffWords(a: string, b: string): WordOp[] {
  const A = a.split(/(\s+)/).filter(Boolean);
  const B = b.split(/(\s+)/).filter(Boolean);
  const n = A.length;
  const m = B.length;
  const L: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const ops: WordOp[] = [];
  const push = (op: WordOp["op"], text: string) => {
    const last = ops[ops.length - 1];
    if (last && last.op === op) last.text += text;
    else ops.push({ op, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      push("same", A[i]);
      i++;
      j++;
    } else if (L[i + 1][j] >= L[i][j + 1]) push("del", A[i++]);
    else push("add", B[j++]);
  }
  while (i < n) push("del", A[i++]);
  while (j < m) push("add", B[j++]);
  return ops;
}

/** Everything that differs between two versions, in document order. Empty means identical. */
export function diffVersions(a: AgreementBody, b: AgreementBody): Change[] {
  const out: Change[] = [];
  const tpl = (x: AgreementBody) => (x.template.version_no ? `${x.template.name} (v${x.template.version_no})` : x.template.name);
  if (tpl(a) !== tpl(b)) out.push({ kind: "value", key: "template", label: "Template", before: tpl(a), after: tpl(b) });
  for (const [key, label, show] of VALUE_LABELS) {
    const before = show(a.values);
    const after = show(b.values);
    if (before !== after) out.push({ kind: "value", key, label, before, after });
  }
  const aBy = new Map(a.blocks.map((x) => [x.id, x]));
  const bBy = new Map(b.blocks.map((x) => [x.id, x]));
  const ids = [...new Set([...a.blocks.map((x) => x.id), ...b.blocks.map((x) => x.id)])];
  for (const id of ids) {
    const x = aBy.get(id);
    const y = bBy.get(id);
    if (x && !y) out.push({ kind: "block", id, title: x.title, change: "removed", words: [{ op: "del", text: x.text }] });
    else if (!x && y) out.push({ kind: "block", id, title: y.title, change: "added", words: [{ op: "add", text: y.text }] });
    else if (x && y && (x.text !== y.text || x.title !== y.title)) {
      const words = x.title !== y.title ? [{ op: "del" as const, text: `${x.title}: ` }, { op: "add" as const, text: `${y.title}: ` }, ...diffWords(x.text, y.text)] : diffWords(x.text, y.text);
      out.push({ kind: "block", id, title: y.title, change: "edited", words });
    }
  }
  return out;
}

/** Blocks whose text no longer matches what they started from (the quote section or the template clause). */
export function editedBlocks(body: AgreementBody): string[] {
  return body.blocks.filter((b) => b.base !== null && b.text.trim() !== b.base.trim()).map((b) => b.id);
}

// ── From a job ──────────────────────────────────────────────────────────────

export type JobForDraft = DraftInput["quote"] & { service: string | null; deposit_target_cents?: number | null };
export type LineForDraft = { title: string; description: string | null; required?: boolean; customer_response: string | null };

/**
 * What a new draft is built from: the job as approved, the lines the customer took (the package they picked first,
 * then required and accepted options), the contractor, and the job's money. The deposit is the job's deposit
 * target (what must be paid in total before work starts) when one is set, else the standard deposit (half).
 * Which clauses are on, and the tax wording, come from the template chosen (repair jobs default to Repair).
 */
export function draftInputFromJob(input: {
  today: string;
  quote: JobForDraft;
  options: LineForDraft[];
  packages: LineForDraft[];
  contractor: DraftInput["contractor"];
  totalCents: number;
  replacesSignedOn?: string | null;
}): DraftInput {
  const pkg = input.packages.find((p) => p.customer_response === "accepted");
  const opts = input.options.filter((o) => o.required || o.customer_response === "accepted");
  const line = (l: LineForDraft) => [l.title, l.description].map((x) => (x ?? "").trim()).filter(Boolean).join(": ");
  const lines = [...(pkg ? [line(pkg)] : []), ...opts.map(line)].filter(Boolean);
  const total = Math.max(0, Math.round(input.totalCents));
  const deposit = jobDepositCents(total, input.quote.deposit_target_cents);
  return {
    today: input.today,
    quote: input.quote,
    boughtLines: lines,
    contractor: input.contractor,
    totalCents: total,
    depositCents: deposit,
    // Tax wording and optional clauses come from the template chosen (Repair jobs default to the Repair template).
    replacesSignedOn: input.replacesSignedOn ?? null,
  };
}

/** The deposit printed on the agreement: the job's deposit target when set, else the standard half. Never above the total. */
export function jobDepositCents(totalCents: number, targetCents: number | null | undefined): number {
  const total = Math.max(0, Math.round(totalCents));
  const want = targetCents != null && targetCents > 0 ? Math.round(targetCents) : Math.round((total * DEFAULT_DEPOSIT_PERCENT) / 100);
  return Math.min(want, total);
}

/**
 * Bring a draft up to date with the job (a change order, a contractor's new license #) without losing anyone's
 * edits: the money is replaced with the job's; names and numbers are filled in only where blank; a work section
 * nobody edited takes the job's new text, and an edited one keeps its text but now shows as differing from the
 * quote. The date and the editor's choices (tax wording, payment methods) stay.
 */
export function refreshFromJob(body: AgreementBody, fresh: AgreementBody): AgreementBody {
  const keep = body.values;
  const fill = (k: "customer_name" | "customer_phone" | "customer_email" | "job_address" | "contractor_name" | "contractor_license" | "contractor_phone") =>
    keep[k].trim() ? keep[k] : fresh.values[k];
  const values: AgreementValues = {
    ...keep,
    // The money is the job's, always.
    total_cents: fresh.values.total_cents,
    deposit_cents: fresh.values.deposit_cents,
    // Names and numbers someone typed stay; blanks are filled from the job.
    customer_name: fill("customer_name"),
    customer_phone: fill("customer_phone"),
    customer_email: fill("customer_email"),
    job_address: fill("job_address"),
    contractor_name: fill("contractor_name"),
    contractor_license: fill("contractor_license"),
    contractor_phone: fill("contractor_phone"),
  };
  const freshBy = new Map(fresh.blocks.map((b) => [b.id, b]));
  const blocks = body.blocks.map((b) => {
    const f = freshBy.get(b.id);
    if (b.kind !== "work" || !f) return b;
    const untouched = b.base !== null && b.text.trim() === b.base.trim();
    return untouched ? { ...b, text: f.text, base: f.base } : { ...b, base: f.base };
  });
  return { ...body, values, blocks };
}
