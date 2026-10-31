// The two templates the Documents hub starts with, as data. scripts/template-seed-sql.ts prints them as the SQL in
// the document_templates migration, so what is seeded is exactly what the engine and its tests use.
//
//   Standard Work Agreement: the Drive master ("CUSTOMER AGREEMENT AND WORK AUTH TEMPLATE DO NOT EDIT"), with the
//     Alexavier amendment's clauses as switches. Identical to BUILTIN_STANDARD.
//   Repair Agreement: the Drive "Alexavier_95_Parkland_Dr_Amended_Agreement", made generic: Repair Limitations
//     (initialed) on, Insurance and Limitation of Liability on, no Warranty section, the cancellation notice may go
//     to the Contractor too, prices include tax by default, and its longer Authorization (without the "amended
//     agreement" sentence, which the engine adds only to an agreement that replaces a signed one).
import { BUILTIN_STANDARD, type TemplateBody, type TemplateClause } from "./agreement-doc.ts";

const std = (id: string): TemplateClause => {
  const c = BUILTIN_STANDARD.clauses.find((x) => x.id === id);
  if (!c) throw new Error(`no standard clause ${id}`);
  return c;
};

export const STANDARD_SEED: { name: string; body: TemplateBody } = {
  name: BUILTIN_STANDARD.name,
  body: { tax_mode: BUILTIN_STANDARD.tax_mode, clauses: BUILTIN_STANDARD.clauses },
};

export const REPAIR_SEED: { name: string; body: TemplateBody } = {
  name: "Repair Agreement",
  body: {
    tax_mode: "includes_tax",
    clauses: [
      std("clause.basics"),
      { ...std("clause.repair"), optional: false, on_by_default: false },
      std("clause.responsible"),
      { ...std("clause.insurance"), optional: false, on_by_default: false },
      { ...std("clause.liability"), optional: false, on_by_default: false },
      {
        ...std("clause.cancel"),
        text: "If you signed this at your home, you may cancel within 3 business days by written notice to Raleigh Concrete Group or the Contractor at the contact above. Any deposit is refunded within 10 days.",
      },
      {
        id: "clause.authorization",
        kind: "clause",
        title: "Authorization",
        text: "I authorize the Contractor to perform the work described above at the price shown. I have read and understand the concrete basics, repair limitations, warranty, insurance, limitation of liability, and cancellation terms.",
        text_includes_tax:
          "I authorize the Contractor to perform the work described above for the total price shown, which includes all taxes and fees. I have read and understand the concrete basics, repair limitations, warranty, insurance, limitation of liability, and cancellation terms.",
        optional: false,
        on_by_default: false,
      },
    ],
  },
};

/** The template a new agreement starts from when nobody picks one: Repair for a repair job, else Standard. */
export const defaultTemplateNameFor = (service: string | null | undefined) =>
  /repair/i.test(service ?? "") ? REPAIR_SEED.name : STANDARD_SEED.name;
