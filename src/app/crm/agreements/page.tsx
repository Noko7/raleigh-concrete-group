import { redirect } from "next/navigation";

import { crmBase } from "@/lib/crm/nav";

// Agreements moved into Documents, with receipts. Kept so old links and bookmarks still land.
export default async function AgreementsPage() {
  redirect(`${await crmBase()}/documents`);
}
