import { redirect } from "next/navigation";

import { crmBase } from "@/lib/crm/nav";

// Receipts moved into Documents. Kept so old links and bookmarks still land on the same year.
export default async function ReceiptsPage({ searchParams }: { searchParams: Promise<{ year?: string; tests?: string }> }) {
  const sp = await searchParams;
  const qs = new URLSearchParams({ view: "receipts" });
  if (sp.year) qs.set("year", sp.year);
  if (sp.tests === "1") qs.set("tests", "1");
  redirect(`${await crmBase()}/documents?${qs}`);
}
