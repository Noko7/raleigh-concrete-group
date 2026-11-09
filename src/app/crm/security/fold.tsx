import type { ReactNode } from "react";

// A table on the Security page that folds away. A native <details>, so it needs no script and works on a phone;
// closed by default so the page is a list of headings, each with its row count (and a warning, when there's one
// worth opening it for).
export function Fold({
  title,
  count,
  alert,
  note,
  level = 2,
  open = false,
  id,
  children,
}: {
  title: string;
  count?: number;
  alert?: string | null;
  note?: string | null;
  level?: 2 | 3;
  open?: boolean;
  id?: string;
  children: ReactNode;
}) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <details className="crm-card sec-fold" open={open} id={id}>
      <summary>
        <Heading className={level === 2 ? "crm-card-title" : "sec-h3"}>{title}</Heading>
        {count !== undefined && <span className="jb-count">{count.toLocaleString()}</span>}
        {alert && <span className="crm-badge crm-badge-danger">{alert}</span>}
        {note && <span className="crm-muted crm-sm">{note}</span>}
      </summary>
      <div className="sec-fold-body">{children}</div>
    </details>
  );
}
