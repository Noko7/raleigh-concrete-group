// Prints the seed rows for the document_templates migration from src/lib/crm/template-seeds.ts, so the templates
// the database starts with are exactly the ones the engine and its tests use.
//
//   node scripts/template-seed-sql.ts
import { REPAIR_SEED, STANDARD_SEED } from "../src/lib/crm/template-seeds.ts";

const seeds = [
  { ...STANDARD_SEED, note: "Seeded from the Drive master (CUSTOMER AGREEMENT AND WORK AUTH TEMPLATE)" },
  { ...REPAIR_SEED, note: "Seeded from the Drive repair agreement (Alexavier, 95 Parkland Dr), made generic" },
];

for (const s of seeds) {
  const json = JSON.stringify(s.body);
  if (json.includes("$seed$")) throw new Error("seed text contains the dollar-quote tag");
  console.log(`with t as (
  insert into public.document_templates (name, created_by_name) values ('${s.name.replace(/'/g, "''")}', 'Seeded from Google Drive') returning id
)
insert into public.document_template_versions (template_id, version_no, body, note, created_by_name)
  select id, 1, $seed$${json}$seed$::jsonb, '${s.note.replace(/'/g, "''")}', 'Seeded from Google Drive' from t;
`);
}
