"use client";

import { useDeferredValue, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { draftAgreement, renderAgreementHtml, type Change, type TemplateBody, type TemplateClause } from "@/lib/crm/agreement-doc";
import { SAMPLE_JOB, diffTemplates, moveClause, newClause } from "@/lib/crm/template-tools";
import type { TemplateVersionSummary } from "@/lib/crm/templates";
import { getTemplateVersionAction, renameTemplateAction, saveTemplateAction, setTemplateStatusAction } from "../actions";

// An agreement template, edited section by section beside a live preview drawn with a sample job. Every save is a
// new numbered version; the history can be viewed, compared and restored like an agreement's. Agreements already
// written keep the version they were drafted from, so nothing here changes them.

const PREVIEW_CSS =
  "signature-field,initials-field,date-field{display:inline-block;border:1.5px dashed #c2682a;border-radius:4px;background:#fdf3ec;vertical-align:middle}" +
  "signature-field::before,initials-field::before,date-field::before{content:attr(name);font:9px Helvetica,Arial,sans-serif;color:#9a4f1c;padding:2px 4px;display:block}" +
  "body{max-width:7.5in;margin:24px auto;padding:0 16px}";

function previewOf(body: TemplateBody, name: string) {
  const html = renderAgreementHtml(draftAgreement({ ...SAMPLE_JOB, template: { ...body, id: null, version_no: null, name } }));
  return html.replace("</head>", `<style>${PREVIEW_CSS}</style></head>`);
}

function when(iso: string) {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
}

export function TemplateEditor({
  template,
  initial,
  versions,
}: {
  template: { id: string; name: string; status: "active" | "archived" };
  initial: TemplateBody;
  versions: TemplateVersionSummary[];
}) {
  const router = useRouter();
  const [body, setBody] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [history, setHistory] = useState(versions);
  const [name, setName] = useState(template.name);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [pick, setPick] = useState<string[]>([]);
  const [modal, setModal] = useState<{ kind: "preview"; title: string; html: string } | { kind: "compare"; title: string; changes: Change[] } | null>(null);
  const dirty = useMemo(() => JSON.stringify(body) !== JSON.stringify(saved), [body, saved]);
  const latest = history[0];
  const deferred = useDeferredValue(body);
  const live = useMemo(() => previewOf(deferred, name), [deferred, name]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const setClause = (id: string, patch: Partial<TemplateClause>) =>
    setBody((b) => ({ ...b, clauses: b.clauses.map((c) => (c.id === id ? { ...c, ...patch, on_by_default: (patch.optional ?? c.optional) && (patch.on_by_default ?? c.on_by_default) } : c)) }));

  const act = (f: () => Promise<{ ok: boolean; error?: string }>, okText: string) =>
    start(async () => {
      setMsg(null);
      const r = await f();
      setMsg(r.ok ? { ok: true, text: okText } : { ok: false, text: r.error ?? "Something went wrong." });
      if (r.ok) router.refresh();
    });

  function save() {
    start(async () => {
      setMsg(null);
      const r = await saveTemplateAction(template.id, body, note, latest?.id ?? null);
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      setBody(r.body);
      setSaved(r.body);
      setHistory((h) => [r.version, ...h]);
      setNote("");
      setMsg({ ok: true, text: `Saved as version ${r.version.version_no}. New agreements start from it.` });
    });
  }

  function load(v: TemplateVersionSummary, then: (b: TemplateBody, no: number) => void) {
    start(async () => {
      const r = await getTemplateVersionAction(v.id);
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      then(r.body, r.version_no);
    });
  }

  function compare() {
    const [a, b] = pick.map((id) => history.find((h) => h.id === id)!).sort((x, y) => x.version_no - y.version_no);
    start(async () => {
      const [ra, rb] = await Promise.all([getTemplateVersionAction(a.id), getTemplateVersionAction(b.id)]);
      if (!ra.ok || !rb.ok) return setMsg({ ok: false, text: "Couldn't load both versions." });
      setModal({ kind: "compare", title: `Version ${ra.version_no} → version ${rb.version_no}`, changes: diffTemplates(ra.body, rb.body) });
    });
  }

  return (
    <section className="crm-card ae" aria-label="Template">
      <div className="ae-head">
        <div>
          <h1 className="crm-card-title">
            {template.name}
            {template.status === "archived" && <span className="rl-tag">Archived</span>}
          </h1>
          <p className="crm-muted crm-sm">
            {latest ? `Version ${latest.version_no} saved ${when(latest.created_at)}${latest.created_by_name ? ` by ${latest.created_by_name}` : ""}.` : "Not saved yet."}
            {dirty && <strong className="ae-dirty"> Unsaved changes.</strong>}
          </p>
        </div>
        <div className="ae-head-acts">
          <button type="button" className="crm-btn crm-btn-ghost" onClick={() => setModal({ kind: "preview", title: "Preview with a sample job", html: live })}>
            Preview
          </button>
          {template.status === "active" ? (
            <button
              type="button"
              className="crm-btn crm-btn-ghost"
              disabled={pending}
              onClick={() => window.confirm("Archive this template? It won't be offered for new agreements.") && act(() => setTemplateStatusAction(template.id, "archived"), "Archived.")}
            >
              Archive
            </button>
          ) : (
            <button type="button" className="crm-btn crm-btn-ghost" disabled={pending} onClick={() => act(() => setTemplateStatusAction(template.id, "active"), "Restored.")}>
              Restore
            </button>
          )}
        </div>
      </div>

      <div className="ae-layout">
        <div className="ae-form">
          <fieldset className="ae-group">
            <legend>Name</legend>
            <div className="ae-save">
              <input className="crm-input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} aria-label="Template name" />
              <button type="button" className="crm-btn crm-btn-ghost" disabled={pending || !name.trim() || name === template.name} onClick={() => act(() => renameTemplateAction(template.id, name), "Renamed.")}>
                Rename
              </button>
            </div>
          </fieldset>

          <fieldset className="ae-group">
            <legend>Tax wording, by default</legend>
            <div className="ae-choices" role="radiogroup" aria-label="Tax wording">
              {(
                [
                  ["plus_tax", "Plus tax & any permit fees"],
                  ["includes_tax", "Includes all sales tax and fees"],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="ae-choice">
                  <input type="radio" name="tax" checked={body.tax_mode === k} onChange={() => setBody((b) => ({ ...b, tax_mode: k }))} />
                  {label}
                </label>
              ))}
            </div>
            <p className="crm-muted crm-sm">The five work sections, the price table and the signatures are on every agreement; these are the terms after them.</p>
          </fieldset>

          <fieldset className="ae-group">
            <legend>Sections</legend>
            {body.clauses.map((c, i) => {
              const isAuth = c.id === "clause.authorization";
              return (
                <div key={c.id} className="te-clause">
                  <div className="te-row">
                    <input className="crm-input te-title" value={c.title} maxLength={120} aria-label="Section title" onChange={(e) => setClause(c.id, { title: e.target.value })} />
                    <span className="te-moves">
                      <button type="button" className="ae-link" aria-label={`Move ${c.title} up`} disabled={i === 0} onClick={() => setBody((b) => moveClause(b, c.id, -1))}>
                        ↑
                      </button>
                      <button type="button" className="ae-link" aria-label={`Move ${c.title} down`} disabled={i === body.clauses.length - 1} onClick={() => setBody((b) => moveClause(b, c.id, 1))}>
                        ↓
                      </button>
                    </span>
                  </div>
                  <textarea className="crm-input ae-text" rows={Math.min(12, Math.max(3, c.text.split("\n").length + 1))} value={c.text} maxLength={8000} onChange={(e) => setClause(c.id, { text: e.target.value })} />
                  <div className="ae-choices">
                    <label className="ae-choice">
                      <input type="checkbox" checked={c.kind === "initials"} disabled={isAuth} onChange={(e) => setClause(c.id, { kind: e.target.checked ? "initials" : "clause" })} />
                      Customer initials each bullet
                    </label>
                    <label className="ae-choice">
                      <input type="checkbox" checked={c.optional} disabled={isAuth} onChange={(e) => setClause(c.id, { optional: e.target.checked })} />
                      Optional (a switch on the agreement)
                    </label>
                    {c.optional && (
                      <label className="ae-choice">
                        <input type="checkbox" checked={c.on_by_default} onChange={(e) => setClause(c.id, { on_by_default: e.target.checked })} />
                        On by default
                      </label>
                    )}
                  </div>
                  <details className="te-alt" open={Boolean(c.text_includes_tax)}>
                    <summary>Different wording when the price includes tax</summary>
                    <textarea
                      className="crm-input ae-text"
                      rows={3}
                      value={c.text_includes_tax ?? ""}
                      maxLength={8000}
                      placeholder="Leave blank to use the same wording either way."
                      onChange={(e) => setClause(c.id, { text_includes_tax: e.target.value || null })}
                    />
                  </details>
                  {!isAuth && (
                    <button type="button" className="ae-reset" onClick={() => setBody((b) => ({ ...b, clauses: b.clauses.filter((x) => x.id !== c.id) }))}>
                      Remove this section
                    </button>
                  )}
                </div>
              );
            })}
            <button
              type="button"
              className="crm-btn crm-btn-ghost"
              disabled={body.clauses.length >= 30}
              onClick={() =>
                setBody((b) => {
                  const add = newClause("New section", b.clauses.map((c) => c.id));
                  const at = b.clauses.findIndex((c) => c.id === "clause.authorization");
                  const clauses = [...b.clauses];
                  clauses.splice(at < 0 ? clauses.length : at, 0, add);
                  return { ...b, clauses };
                })
              }
            >
              Add a section
            </button>
            <p className="crm-muted crm-sm">A line starting with &quot;- &quot; is a bullet. **Bold** is bold. Authorization is always on every agreement.</p>
          </fieldset>

          <div className="ae-save">
            <input className="crm-input" placeholder="What changed? (optional)" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
            <div className="ae-save-acts">
              {dirty && latest && (
                <button type="button" className="crm-btn crm-btn-ghost" onClick={() => setModal({ kind: "compare", title: `Version ${latest.version_no} → your changes`, changes: diffTemplates(saved, body) })}>
                  See changes
                </button>
              )}
              <button type="button" className="crm-btn crm-btn-primary" onClick={save} disabled={!dirty || pending}>
                {pending ? "Saving…" : "Save version"}
              </button>
            </div>
          </div>
          {msg && (
            <p className={msg.ok ? "jr-ok" : "jr-err"} role={msg.ok ? "status" : "alert"}>
              {msg.text}
            </p>
          )}
        </div>
        <aside className="ae-live" aria-label="Live preview">
          <iframe title="Live preview of the template" className="ae-live-frame" sandbox="" srcDoc={live} />
        </aside>
      </div>

      {history.length > 0 && (
        <div className="ae-history">
          <h3>Versions</h3>
          <p className="crm-muted crm-sm">Every save is kept exactly as it was. Tick two to compare them.</p>
          <ul>
            {history.map((h) => (
              <li key={h.id}>
                <label className="ae-pick">
                  <input
                    type="checkbox"
                    checked={pick.includes(h.id)}
                    onChange={(e) => setPick((p) => (e.target.checked ? [...p.slice(-1), h.id] : p.filter((x) => x !== h.id)))}
                    aria-label={`Pick version ${h.version_no} to compare`}
                  />
                  <strong>v{h.version_no}</strong>
                </label>
                <span className="ae-h-meta">
                  {when(h.created_at)}
                  {h.created_by_name ? ` · ${h.created_by_name}` : ""}
                  {h.note ? ` · ${h.note}` : ""}
                </span>
                <span className="ae-h-acts">
                  <button type="button" className="ae-link" onClick={() => load(h, (b, no) => setModal({ kind: "preview", title: `Version ${no}, with a sample job`, html: previewOf(b, name) }))}>
                    View
                  </button>
                  {h.id !== latest?.id && (
                    <button
                      type="button"
                      className="ae-link"
                      onClick={() =>
                        (!dirty || window.confirm("Replace your unsaved changes with this version?")) &&
                        load(h, (b, no) => {
                          setBody(b);
                          setNote(`Restored version ${no}`);
                          setMsg({ ok: true, text: `Version ${no} loaded. Save to make it the newest version.` });
                        })
                      }
                    >
                      Restore
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <button type="button" className="crm-btn crm-btn-ghost" disabled={pick.length !== 2 || pending} onClick={compare}>
            Compare the two ticked
          </button>
        </div>
      )}

      {modal && (
        <div className="cv" role="dialog" aria-modal="true" aria-label={modal.title} onClick={() => setModal(null)}>
          <div className="cv-panel" onClick={(e) => e.stopPropagation()}>
            <div className="cv-head">
              <div className="cv-title">
                <h2>{modal.title}</h2>
              </div>
              <button type="button" className="qsm-x" aria-label="Close" onClick={() => setModal(null)}>
                &times;
              </button>
            </div>
            {modal.kind === "preview" ? (
              <div className="cv-stage">
                <iframe title={modal.title} className="cv-frame" sandbox="" srcDoc={modal.html} />
              </div>
            ) : (
              <div className="ae-diff">
                {modal.changes.length === 0 ? (
                  <p>No differences.</p>
                ) : (
                  modal.changes.map((c, i) =>
                    c.kind === "value" ? (
                      <div key={i} className="ae-d-row">
                        <strong>{c.label}</strong>
                        <div>
                          <del>{c.before || "(blank)"}</del> → <ins>{c.after || "(blank)"}</ins>
                        </div>
                      </div>
                    ) : (
                      <div key={i} className="ae-d-row">
                        <strong>
                          {c.title} <em>({c.change})</em>
                        </strong>
                        <div className="ae-d-text">
                          {c.words.map((w, j) => (w.op === "same" ? <span key={j}>{w.text}</span> : w.op === "add" ? <ins key={j}>{w.text}</ins> : <del key={j}>{w.text}</del>))}
                        </div>
                      </div>
                    ),
                  )
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
