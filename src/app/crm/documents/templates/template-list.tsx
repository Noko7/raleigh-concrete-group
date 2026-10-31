"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { cloneTemplateAction, createTemplateAction, setTemplateStatusAction } from "./actions";

// The owner's agreement templates: open one to edit (every save is a version), copy one to make a variant, archive
// one so it can't start new agreements (agreements already written keep their own copy), or restore it.
export type TemplateRow = { id: string; name: string; status: "active" | "archived"; versionNo: number | null; updatedAt: string; clonedFrom: string | null };

function day(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });
}

export function TemplateList({ base, rows }: { base: string; rows: TemplateRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [from, setFrom] = useState(rows.find((r) => r.status === "active")?.id ?? "");
  const run = (f: () => Promise<{ ok: boolean; error?: string; id?: string }>, go?: boolean) =>
    start(async () => {
      setError(null);
      const r = await f();
      if (!r.ok) return setError(r.error ?? "Something went wrong.");
      if (go && r.id) router.push(`${base}/documents/templates/${r.id}`);
      else router.refresh();
    });

  const active = rows.filter((r) => r.status === "active");
  const archived = rows.filter((r) => r.status === "archived");
  const card = (r: TemplateRow) => (
    <li key={r.id} className={r.status === "archived" ? "tl-row tl-archived" : "tl-row"}>
      <Link href={`${base}/documents/templates/${r.id}`} className="tl-name">
        {r.name}
      </Link>
      <span className="tl-meta">
        {r.versionNo ? `v${r.versionNo}` : "no versions"} · updated {day(r.updatedAt)}
        {r.clonedFrom ? ` · copied from ${r.clonedFrom}` : ""}
      </span>
      <span className="tl-acts">
        <Link href={`${base}/documents/templates/${r.id}`} className="ae-link">
          Edit
        </Link>
        <button type="button" className="ae-link" disabled={pending} onClick={() => run(() => cloneTemplateAction(r.id), true)}>
          Copy
        </button>
        {r.status === "active" ? (
          <button
            type="button"
            className="ae-link"
            disabled={pending}
            onClick={() => window.confirm(`Archive "${r.name}"? It won't be offered for new agreements; agreements already written aren't affected.`) && run(() => setTemplateStatusAction(r.id, "archived"))}
          >
            Archive
          </button>
        ) : (
          <button type="button" className="ae-link" disabled={pending} onClick={() => run(() => setTemplateStatusAction(r.id, "active"))}>
            Restore
          </button>
        )}
      </span>
    </li>
  );

  return (
    <>
      <p className="crm-muted crm-sm">
        The wording new agreements start from. Every save of a template is kept as a version; agreements keep a copy of the
        version they were written from, so editing or archiving a template never changes an agreement already written or signed.
      </p>
      <form
        className="tl-new"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => createTemplateAction(name, from || null), true);
        }}
      >
        <label className="ae-field">
          <span>New template name</span>
          <input className="crm-input" value={name} maxLength={120} placeholder="e.g. Stamped Concrete Agreement" onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="ae-field">
          <span>Start from</span>
          <select className="crm-input" value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">Blank (just the Authorization)</option>
            {rows.map((r) => (
              <option key={r.id} value={r.id}>
                A copy of {r.name}
                {r.status === "archived" ? " (archived)" : ""}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="crm-btn crm-btn-primary" disabled={pending || !name.trim()}>
          {pending ? "Working…" : "Create template"}
        </button>
      </form>
      {error && (
        <p className="jr-err" role="alert">
          {error}
        </p>
      )}
      <ul className="tl-list">{active.map(card)}</ul>
      {archived.length > 0 && (
        <details className="tl-archive">
          <summary>Archived ({archived.length})</summary>
          <ul className="tl-list">{archived.map(card)}</ul>
        </details>
      )}
    </>
  );
}
