"use client";

import { useDeferredValue, useEffect, useMemo, useState, useTransition } from "react";

import {
  PAYMENT_METHODS,
  addCustomBlock,
  clauseBlock,
  diffVersions,
  editedBlocks,
  money,
  optionalClauseIds,
  refreshFromJob,
  renderAgreementHtml,
  sendProblems,
  setTaxMode,
  toggleClause,
  type AgreementBody,
  type AgreementValues,
  type Change,
  type PayMethod,
} from "@/lib/crm/agreement-doc";
import type { VersionSummary } from "@/lib/crm/agreement-versions";
import { PageEditor } from "./page-editor";
import { draftFromJobAction, getVersionAction, saveVersionAction } from "./agreement-actions";

// The customer agreement, edited as a form (one box per section, big enough to type in on a phone) beside a live
// preview of the exact document (on a phone, Preview opens it full screen). Each save is a new numbered version; nothing saved is ever changed, so the
// history below is the whole back-and-forth. An old version can be viewed, compared with any other, or restored
// (which saves it again as the newest version).

const METHOD_NAMES: Record<PayMethod, string> = { zelle: "Zelle", venmo: "Venmo", check: "Check", cash: "Cash" };

// Signature, initials and date fields are DocuSeal tags; in the preview they are drawn as labelled boxes.
const PREVIEW_CSS =
  "signature-field,initials-field,date-field{display:inline-block;border:1.5px dashed #c2682a;border-radius:4px;background:#fdf3ec;vertical-align:middle}" +
  "signature-field::before,initials-field::before,date-field::before{content:attr(name);font:9px Helvetica,Arial,sans-serif;color:#9a4f1c;padding:2px 4px;display:block}" +
  "body{max-width:7.5in;margin:24px auto;padding:0 16px}";

function previewDoc(html: string) {
  return html.replace("</head>", `<style>${PREVIEW_CSS}</style></head>`);
}

function when(iso: string) {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
}

export function AgreementEditor({
  quoteId,
  agreementId,
  initial,
  versions,
  canEdit,
  closed,
}: {
  quoteId: string;
  agreementId: string;
  initial: AgreementBody;
  versions: VersionSummary[];
  canEdit: boolean;
  /** Signed or void: read-only; changes go into an amendment. */
  closed: boolean;
}) {
  const [body, setBody] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [history, setHistory] = useState(versions);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [modal, setModal] = useState<
    | { kind: "preview"; title: string; html: string }
    | { kind: "compare"; title: string; changes: Change[] }
    | null
  >(null);
  const [pick, setPick] = useState<string[]>([]);
  // Two ways to edit the same body: a form (roomy boxes, best on a phone) or the page itself, click and type.
  const [mode, setMode] = useState<"form" | "page">("form");
  // Set while a paragraph on the page is being typed in and not yet committed (it commits when it loses focus).
  const [typing, setTyping] = useState(false);

  const readOnly = !canEdit || closed;
  const dirty = useMemo(() => typing || JSON.stringify(body) !== JSON.stringify(saved), [typing, body, saved]);
  const problems = useMemo(() => sendProblems(body), [body]);
  const edited = useMemo(() => new Set(editedBlocks(body)), [body]);
  const latest = history[0];

  // Leaving with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const setValue = <K extends keyof AgreementValues>(k: K, v: AgreementValues[K]) => setBody((b) => ({ ...b, values: { ...b.values, [k]: v } }));
  const setBlock = (id: string, patch: { text?: string; title?: string }) => {
    setTyping(false);
    setBody((b) => ({ ...b, blocks: b.blocks.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
  };

  function save() {
    setMsg(null);
    start(async () => {
      const r = await saveVersionAction(quoteId, agreementId, body, note, latest?.id ?? null);
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      // What the server stored: the job's money may differ from what this page had.
      setBody(r.body);
      setSaved(r.body);
      setHistory((h) => [r.version, ...h]);
      setNote("");
      setMsg({ ok: true, text: `Saved as version ${r.version.version_no}.` });
    });
  }

  function refreshJob() {
    setMsg(null);
    start(async () => {
      const r = await draftFromJobAction(quoteId);
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      const next = refreshFromJob(body, r.body);
      const changes = diffVersions(body, next);
      setBody(next);
      setMsg({ ok: true, text: changes.length ? `Brought in ${changes.length} change${changes.length === 1 ? "" : "s"} from the job. Save to keep them.` : "Already matches the job." });
    });
  }

  function view(v: VersionSummary) {
    start(async () => {
      const r = await getVersionAction(v.id);
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      setModal({ kind: "preview", title: `Version ${r.version_no}, as saved`, html: r.html });
    });
  }

  function restore(v: VersionSummary) {
    if (dirty && !window.confirm("Replace your unsaved changes with this version?")) return;
    start(async () => {
      const r = await getVersionAction(v.id);
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      setBody(r.body);
      setMsg({ ok: true, text: `Version ${r.version_no} loaded. Save to make it the newest version (the price will be the job's current price).` });
      setNote(`Restored version ${r.version_no}`);
      // The price on a saved version is always the job's at the time it is saved.
    });
  }

  function compare() {
    const [a, b] = [...pick].map((id) => history.find((h) => h.id === id)!).sort((x, y) => x.version_no - y.version_no);
    start(async () => {
      const [ra, rb] = await Promise.all([getVersionAction(a.id), getVersionAction(b.id)]);
      if (!ra.ok || !rb.ok) return setMsg({ ok: false, text: "Couldn't load both versions." });
      setModal({ kind: "compare", title: `Version ${ra.version_no} → version ${rb.version_no}`, changes: diffVersions(ra.body, rb.body) });
    });
  }

  function compareWithSaved() {
    setModal({ kind: "compare", title: `Version ${latest?.version_no ?? "?"} → your changes`, changes: diffVersions(saved, body) });
  }

  const v = body.values;
  // Rendered from a deferred copy, so typing stays quick on a phone while the preview catches up.
  const deferred = useDeferredValue(body);
  const liveHtml = useMemo(() => previewDoc(renderAgreementHtml(deferred)), [deferred]);
  const work = body.blocks.filter((b) => b.kind === "work");
  const clauses = body.blocks.filter((b) => b.kind === "clause" || b.kind === "initials");
  const customs = body.blocks.filter((b) => b.kind === "custom");

  return (
    <section className="crm-card ae" aria-label="Customer agreement">
      <div className="ae-head">
        <div>
          <h2 className="crm-card-title">Customer agreement</h2>
          <p className="crm-muted crm-sm">
            {latest ? `Version ${latest.version_no} saved ${when(latest.created_at)}${latest.created_by_name ? ` by ${latest.created_by_name}` : ""}.` : "Not saved yet."}
            {dirty && <strong className="ae-dirty"> Unsaved changes.</strong>}
          </p>
        </div>
        <div className="ae-head-acts">
          <button type="button" className="crm-btn crm-btn-ghost" aria-pressed={mode === "page"} onClick={() => setMode((m) => (m === "form" ? "page" : "form"))}>
            {mode === "form" ? "Edit on the page" : "Edit as a form"}
          </button>
          <button type="button" className="crm-btn crm-btn-ghost" onClick={() => setModal({ kind: "preview", title: dirty ? "Preview with your changes" : `Version ${latest?.version_no ?? ""}`, html: renderAgreementHtml(body) })}>
            Preview
          </button>
          {!readOnly && (
            <button type="button" className="crm-btn crm-btn-ghost" onClick={refreshJob} disabled={pending}>
              Refresh from the job
            </button>
          )}
        </div>
      </div>

      <div className="ae-layout">
      <div className="ae-form">
      {closed && <p className="ae-note">This agreement is out for signature or closed, so it can&apos;t be changed.</p>}
      {!canEdit && !closed && <p className="ae-note">Only the owner or the job&apos;s contractor can edit this agreement.</p>}

      <fieldset className="ae-group" disabled={readOnly}>
        <legend>Customer and contractor</legend>
        <div className="ae-grid">
          {(
            [
              ["customer_name", "Customer"],
              ["customer_phone", "Customer phone"],
              ["customer_email", "Customer email"],
              ["job_address", "Job address"],
              ["contractor_name", "Contractor (performs & warrants the work)"],
              ["contractor_license", "Contractor license #"],
              ["contractor_phone", "Contractor phone"],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="ae-field">
              <span>{label}</span>
              <input className="crm-input" value={v[k]} maxLength={k === "job_address" ? 300 : k === "contractor_license" ? 60 : 200} onChange={(e) => setValue(k, e.target.value)} />
            </label>
          ))}
          <label className="ae-field">
            <span>Date on the agreement</span>
            <input className="crm-input" type="date" value={v.date} onChange={(e) => e.target.value && setValue("date", e.target.value)} />
          </label>
        </div>
      </fieldset>

      <fieldset className="ae-group" disabled={readOnly}>
        <legend>Price &amp; payment</legend>
        <p className="ae-money">
          Total <strong>{money(v.total_cents)}</strong> · Deposit <strong>{money(v.deposit_cents)}</strong> · Balance{" "}
          <strong>{money(v.total_cents - v.deposit_cents)}</strong>
        </p>
        <p className="crm-muted crm-sm">From the job. To change the price, change the quote or send a change order, then Refresh from the job.</p>
        <div className="ae-choices" role="radiogroup" aria-label="Tax wording">
          {(
            [
              ["plus_tax", "Plus tax & any permit fees"],
              ["includes_tax", "Includes all sales tax and fees"],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="ae-choice">
              <input type="radio" name="tax" checked={v.tax_mode === k} onChange={() => setBody((b) => setTaxMode(b, k))} />
              {label}
            </label>
          ))}
        </div>
        <div className="ae-choices" aria-label="How you pay">
          {PAYMENT_METHODS.map((m) => (
            <label key={m} className="ae-choice">
              <input
                type="checkbox"
                checked={v.payment_methods.includes(m)}
                onChange={(e) => {
                  const next = e.target.checked ? [...v.payment_methods, m] : v.payment_methods.filter((x) => x !== m);
                  if (next.length) setValue("payment_methods", PAYMENT_METHODS.filter((x) => next.includes(x)));
                }}
              />
              {METHOD_NAMES[m]}
            </label>
          ))}
        </div>
      </fieldset>

      {mode === "form" && (
      <fieldset className="ae-group" disabled={readOnly}>
        <legend>Work to be done</legend>
        {work.map((b) => (
          <label key={b.id} className="ae-field ae-block">
            <span>
              {b.title}
              {edited.has(b.id) && <em className="ae-flag">Differs from the quote</em>}
            </span>
            <textarea className="crm-input ae-text" rows={Math.min(10, Math.max(2, b.text.split("\n").length + 1))} value={b.text} maxLength={8000} onChange={(e) => setBlock(b.id, { text: e.target.value })} />
            {edited.has(b.id) && b.base !== null && (
              <button type="button" className="ae-reset" onClick={() => setBlock(b.id, { text: b.base ?? "" })}>
                Use the quote&apos;s wording
              </button>
            )}
          </label>
        ))}
        <p className="crm-muted crm-sm">A line starting with &quot;- &quot; is a bullet. **Bold** is bold.</p>
      </fieldset>
      )}

      <fieldset className="ae-group" disabled={readOnly}>
        <legend>Terms</legend>
        <div className="ae-choices">
          {optionalClauseIds(body.template).map((id) => (
            <label key={id} className="ae-choice">
              <input type="checkbox" checked={body.blocks.some((b) => b.id === id)} onChange={(e) => setBody((b) => toggleClause(b, id, e.target.checked))} />
              {body.template.clauses.find((c) => c.id === id)?.title}
            </label>
          ))}
        </div>
        {mode === "form" && (
          <>
        {clauses.map((b) => (
          <details key={b.id} className="ae-clause">
            <summary>
              {b.title}
              {edited.has(b.id) && <em className="ae-flag">Edited</em>}
            </summary>
            <textarea className="crm-input ae-text" rows={8} value={b.text} maxLength={8000} onChange={(e) => setBlock(b.id, { text: e.target.value })} />
            {edited.has(b.id) && (
              <button type="button" className="ae-reset" onClick={() => setBlock(b.id, { text: clauseBlock(body.template, b.id, v).text })}>
                Use the template&apos;s wording
              </button>
            )}
          </details>
        ))}
        {customs.map((b) => (
          <div key={b.id} className="ae-field ae-block">
            <input className="crm-input" value={b.title} maxLength={120} aria-label="Section title" onChange={(e) => setBlock(b.id, { title: e.target.value })} />
            <textarea className="crm-input ae-text" rows={4} value={b.text} maxLength={8000} onChange={(e) => setBlock(b.id, { text: e.target.value })} />
            <button type="button" className="ae-reset" onClick={() => setBody((x) => ({ ...x, blocks: x.blocks.filter((y) => y.id !== b.id) }))}>
              Remove this section
            </button>
          </div>
        ))}
          </>
        )}
        <button type="button" className="crm-btn crm-btn-ghost" onClick={() => setBody((b) => addCustomBlock(b, "Additional terms", ""))}>
          Add a section
        </button>
      </fieldset>

      {problems.length > 0 && (
        <div className="ae-problems" role="status">
          <strong>Before this can be sent for signing:</strong>
          <ul>
            {problems.map((p) => (
              <li key={p.field}>{p.message}</li>
            ))}
          </ul>
        </div>
      )}

      {!readOnly && (
        <div className="ae-save">
          <input className="crm-input" placeholder="What changed? (optional)" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
          <div className="ae-save-acts">
            {dirty && latest && (
              <button type="button" className="crm-btn crm-btn-ghost" onClick={compareWithSaved}>
                See changes
              </button>
            )}
            <button type="button" className="crm-btn crm-btn-primary" onClick={save} disabled={!dirty || pending}>
              {pending ? "Saving…" : "Save version"}
            </button>
          </div>
        </div>
      )}
      {msg && <p className={msg.ok ? "jr-ok" : "jr-err"} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}

      </div>
      {mode === "page" ? (
        <div className="ae-pagecol">
          <PageEditor body={body} readOnly={readOnly} setBlock={setBlock} onTyping={() => setTyping(true)} />
        </div>
      ) : (
        <aside className="ae-live" aria-label="Live preview">
          <iframe title="Live preview of the agreement" className="ae-live-frame" sandbox="" srcDoc={liveHtml} />
        </aside>
      )}
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
                  <button type="button" className="ae-link" onClick={() => view(h)}>
                    View
                  </button>
                  {!readOnly && h.id !== latest?.id && (
                    <button type="button" className="ae-link" onClick={() => restore(h)}>
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
                {modal.kind === "preview" && <p>The document exactly as it will be sent. Dashed boxes are where people sign, initial and date.</p>}
              </div>
              <button type="button" className="qsm-x" aria-label="Close" onClick={() => setModal(null)}>
                &times;
              </button>
            </div>
            {modal.kind === "preview" ? (
              <div className="cv-stage">
                {/* sandbox="": no scripts, no navigation. The agreement is plain HTML. */}
                <iframe title={modal.title} className="cv-frame" sandbox="" srcDoc={previewDoc(modal.html)} />
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

