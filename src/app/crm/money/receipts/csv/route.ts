import { getSession } from "@/lib/crm/auth";
import { easternYearStartIso, receiptsCsv, receiptYear } from "@/lib/crm/receipt-format";
import { listReceiptsIssued, receiptNumbersById } from "@/lib/crm/receipts";

export const dynamic = "force-dynamic";

// A year's receipts as CSV for an accountant: every receipt in number order, voided ones included and marked.
// Read as the signed-in user, so RLS decides what's in it (the owner: everything; a contractor: theirs).
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401, headers: { "Cache-Control": "no-store" } });

  const params = new URL(request.url).searchParams;
  const thisYear = receiptYear(new Date().toISOString());
  const year = Number(params.get("year"));
  if (!Number.isInteger(year) || year < 2026 || year > thisYear) {
    return new Response("Bad request", { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const includeTests = params.get("tests") === "1";

  const { rows, ok } = await listReceiptsIssued(session, easternYearStartIso(year), easternYearStartIso(year + 1));
  // A partial export would look complete in a spreadsheet: refuse instead.
  if (!ok) return new Response("Could not read every receipt. Try again.", { status: 503, headers: { "Cache-Control": "no-store" } });

  const shown = includeTests ? rows : rows.filter((r) => !r.is_test);
  const numberOf = new Map(rows.map((r) => [r.id, r.receipt_number]));
  // A correction can replace a receipt from an earlier year: look those numbers up too.
  const outside = shown.map((r) => r.replaces_receipt_id).filter((id): id is string => Boolean(id && !numberOf.has(id)));
  for (const [id, n] of await receiptNumbersById(outside)) numberOf.set(id, n);
  const csv = receiptsCsv(shown, (id) => numberOf.get(id));
  // Byte-order mark: without it Excel reads the UTF-8 as Windows-1252 and mangles accented names.
  return new Response(`\uFEFF${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="receipts-${year}${includeTests ? "-with-practice" : ""}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
