// Pure helpers for the template editor: a blank template, ids for new sections, what changed between two template
// versions, and the sample job the template preview is drawn with. Tested in template-tools.test.ts.
import { BUILTIN_STANDARD, diffWords, type Change, type DraftInput, type TemplateBody, type TemplateClause } from "./agreement-doc.ts";

const AUTH = BUILTIN_STANDARD.clauses.find((c) => c.id === "clause.authorization")!;

/** A template with only the required Authorization section, to write the rest from scratch. */
export const BLANK_TEMPLATE: TemplateBody = { tax_mode: "plus_tax", clauses: [AUTH] };

/** clause.<slug of the title>, made unique among `taken` with _2, _3... */
export function newClauseId(title: string, taken: string[]): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32) || "section";
  let id = `clause.${slug}`;
  for (let n = 2; taken.includes(id); n++) id = `clause.${slug}_${n}`;
  return id;
}

export function newClause(title: string, taken: string[]): TemplateClause {
  return { id: newClauseId(title, taken), kind: "clause", title, text: "", text_includes_tax: null, optional: false, on_by_default: false };
}

/** Move a section up (-1) or down (+1); Authorization stays where it is relative to the others it passes. */
export function moveClause(body: TemplateBody, id: string, by: -1 | 1): TemplateBody {
  const i = body.clauses.findIndex((c) => c.id === id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= body.clauses.length) return body;
  const clauses = [...body.clauses];
  [clauses[i], clauses[j]] = [clauses[j], clauses[i]];
  return { ...body, clauses };
}

const yes = (b: boolean) => (b ? "Yes" : "No");

/** Everything that differs between two versions of a template, in the later one's order. Empty means identical. */
export function diffTemplates(a: TemplateBody, b: TemplateBody): Change[] {
  const out: Change[] = [];
  if (a.tax_mode !== b.tax_mode) {
    const w = (m: string) => (m === "includes_tax" ? "Includes all sales tax and fees" : "Plus tax & any permit fees");
    out.push({ kind: "value", key: "tax_mode", label: "Tax wording", before: w(a.tax_mode), after: w(b.tax_mode) });
  }
  const aBy = new Map(a.clauses.map((c) => [c.id, c]));
  const bBy = new Map(b.clauses.map((c) => [c.id, c]));
  const order = (x: TemplateBody) => x.clauses.map((c) => c.id).filter((id) => aBy.has(id) && bBy.has(id)).join(",");
  if (order(a) !== order(b)) out.push({ kind: "value", key: "order", label: "Section order", before: a.clauses.map((c) => c.title).join(" › "), after: b.clauses.map((c) => c.title).join(" › ") });
  for (const id of [...new Set([...b.clauses.map((c) => c.id), ...a.clauses.map((c) => c.id)])]) {
    const x = aBy.get(id);
    const y = bBy.get(id);
    if (x && !y) {
      out.push({ kind: "block", id, title: x.title, change: "removed", words: [{ op: "del", text: x.text }] });
      continue;
    }
    if (!x && y) {
      out.push({ kind: "block", id, title: y.title, change: "added", words: [{ op: "add", text: y.text }] });
      continue;
    }
    if (!x || !y) continue;
    if (x.title !== y.title) out.push({ kind: "value", key: `${id}.title`, label: `Title of "${y.title}"`, before: x.title, after: y.title });
    if (x.kind !== y.kind) out.push({ kind: "value", key: `${id}.kind`, label: `"${y.title}": initial each item`, before: yes(x.kind === "initials"), after: yes(y.kind === "initials") });
    if (x.optional !== y.optional) out.push({ kind: "value", key: `${id}.optional`, label: `"${y.title}": optional`, before: yes(x.optional), after: yes(y.optional) });
    if (x.on_by_default !== y.on_by_default) out.push({ kind: "value", key: `${id}.on`, label: `"${y.title}": on by default`, before: yes(x.on_by_default), after: yes(y.on_by_default) });
    if (x.text !== y.text) out.push({ kind: "block", id, title: y.title, change: "edited", words: diffWords(x.text, y.text) });
    if ((x.text_includes_tax ?? "") !== (y.text_includes_tax ?? "")) {
      out.push({ kind: "block", id: `${id}.tax`, title: `${y.title} (when the price includes tax)`, change: "edited", words: diffWords(x.text_includes_tax ?? "", y.text_includes_tax ?? "") });
    }
  }
  return out;
}

/** The made-up job a template is previewed with. */
export const SAMPLE_JOB: Omit<DraftInput, "template"> = {
  today: "2026-11-02",
  quote: {
    name: "Sample Customer",
    phone: "+19195550100",
    email: "customer@example.com",
    address: "123 Example St",
    city: "Raleigh",
    quote_scope: "The work described on the quote.",
    quote_permits: "N/A",
    quote_prep: "Site preparation as quoted.",
    quote_pour: "Pour and finish as quoted.",
    quote_cleanup: "Haul all debris.",
    estimated_duration: "1 day",
  },
  boughtLines: [],
  contractor: { full_name: "Sample Contractor", business_name: "Sample Concrete LLC", license_number: "12345", phone: "+19195550199", payment_methods: null },
  totalCents: 500000,
  depositCents: 250000,
  replacesSignedOn: null,
};
