import Link from "next/link";

// A job's documents in one line, on the owner's job page (dark) and the crew's (light). The agreements and
// receipts themselves, with their actions, live in the Documents hub.
export function JobDocsLine({
  href,
  line,
  warning = null,
  tone = "dark",
}: {
  href: string;
  line: string;
  warning?: string | null;
  tone?: "dark" | "light";
}) {
  return (
    <Link href={href} className={tone === "light" ? "js-card dl dl-light" : "crm-card dl"}>
      <span className="dl-label">Documents</span>
      <span className="dl-line">
        {line}
        {warning && <strong className="dl-warn"> · {warning}</strong>}
      </span>
      <span className="dl-go" aria-hidden="true">
        →
      </span>
    </Link>
  );
}
