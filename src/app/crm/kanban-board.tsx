"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { STATUSES, visitDateOf, type Status } from "@/lib/crm/constants";
import { dict, fill, type Dict, type Locale } from "@/lib/crm/i18n";
import { assignQuote, deleteQuote, moveQuote } from "./board-actions";

export type BoardQuote = {
  id: string;
  name: string;
  phone: string;
  service: string | null;
  city: string | null;
  address: string | null;
  status: Status;
  assigned_to: string | null;
  quote_amount: number | null;
  view_count: number;
  quote_type: string | null;
  created_at: string;
  scheduled_date: string | null;
  scheduled_time: string | null;
  visit_date: string | null;
  visit_time: string | null;
  confirmed_at: string | null;
  job_token: string | null;
};

function shortDate(ymd: string | null, locale: Locale): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return "";
  return new Date(`${ymd}T00:00:00`).toLocaleDateString(locale === "es" ? "es-US" : "en-US", {
    month: "short",
    day: "numeric",
  });
}

// ── Ageing ──────────────────────────────────────────────────────────────────
// A lead nobody has quoted yet AND nobody is booked to go and see.
//
// Status alone is the wrong test. It stays "new" until a price goes out, but
// an in-person lead sits in "new" perfectly legitimately while its visit is
// still ahead of it: somebody is driving out on that day, and the price is
// meant to wait until they have seen the job. Ageing that card red would be
// marking a contractor late for following the process.
//
// Once the visit date has passed, it counts again - they went, and no price
// came back, which is exactly the lead worth chasing. Today still counts as
// upcoming, since the visit may not have happened yet.
function isUntouched(q: BoardQuote, today: string): boolean {
  if (q.status !== "new") return false;
  const booked = visitDateOf(q);
  if (booked && booked >= today) return false;
  return true;
}

const hoursSince = (iso: string) => (Date.now() - new Date(iso).getTime()) / 3_600_000;

// The two thresholds the rest of the system already uses: 12 hours is when the
// contractor gets nudged, 48 is when a lead is properly late. Amber then red,
// so a card's colour means the same thing as the texts going out about it.
function ageBadge(q: BoardQuote, today: string): { text: string; tone: "warn" | "late" } | null {
  if (!isUntouched(q, today)) return null;
  const h = hoursSince(q.created_at);
  if (h < 12) return null;
  const text = h < 48 ? `${Math.floor(h)}h` : `${Math.floor(h / 24)}d`;
  return { text, tone: h < 48 ? "warn" : "late" };
}

// Columns where the oldest thing genuinely is the most urgent. Finished work
// is left newest-first: nobody is chasing a job that's already paid.
const OLDEST_FIRST: ReadonlySet<Status> = new Set(["new", "quoted", "approved", "scheduled"]);

// One clear label per lead type so a card reads at a glance.
function typeLabel(q: BoardQuote, t: Dict): { text: string; cls: string } {
  if (q.quote_type === "online") return { text: t.pipeline.typeOnline, cls: "online" };
  if (q.quote_type === "inperson") return { text: t.pipeline.typeInPerson, cls: "inperson" };
  return { text: t.pipeline.typeLead, cls: "inperson" };
}

function telHref(phone: string): string {
  return `tel:${phone.replace(/[^0-9+]/g, "")}`;
}
function smsHref(phone: string): string {
  return `sms:${phone.replace(/[^0-9+]/g, "")}`;
}
function mapsHref(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

type ContractorOption = { id: string; label: string };

type Props = {
  base: string;
  role: "owner" | "contractor";
  initialQuotes: BoardQuote[];
  contractors: ContractorOption[];
  nameMap: Record<string, string>;
  locale: Locale;
};

function money(n: number | null): string {
  return n == null ? "" : `$${Number(n).toLocaleString("en-US")}`;
}

export function KanbanBoard({ base, role, initialQuotes, contractors, nameMap, locale }: Props) {
  const t = dict(locale);
  // Contractors get their own job page - the same URL their texts link to - so a
  // job looks the same however they reach it. Owners get the full editor.
  const cardHref = (q: BoardQuote) =>
    role === "contractor" && q.job_token ? `/job/${q.job_token}` : `${base}/quotes/${q.id}`;
  // Column headings and the Move menu read from the translated status names, so
  // the board doesn't end up half-Spanish.
  const statusLabel = (s: Status) => t.status[s];
  const router = useRouter();
  const [quotes, setQuotes] = useState<BoardQuote[]>(initialQuotes);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<Status | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Adopt fresh server data (e.g. a customer just accepted) without clobbering
  // in-flight optimistic edits: only re-sync when the server snapshot changes.
  const initialSig = useMemo(
    () => initialQuotes.map((q) => `${q.id}:${q.status}:${q.assigned_to ?? ""}:${q.quote_amount ?? ""}`).join("|"),
    [initialQuotes],
  );
  useEffect(() => {
    setQuotes(initialQuotes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSig]);

  // Auto-sync: pull the latest pipeline every 20s so booked/accepted quotes move
  // on their own. Pause while dragging or while a change is saving.
  useEffect(() => {
    const t = setInterval(() => {
      if (!dragId && !isPending) router.refresh();
    }, 20000);
    return () => clearInterval(t);
  }, [dragId, isPending, router]);

  const byStatus = useMemo(() => {
    // Built from STATUSES rather than spelled out, so adding a pipeline stage
    // can't leave this map missing a column.
    const map = Object.fromEntries(STATUSES.map((s) => [s, [] as BoardQuote[]])) as Record<Status, BoardQuote[]>;
    for (const q of quotes) map[q.status]?.push(q);
    // Oldest first in the columns that still need work. The server hands
    // these back newest-first, which puts the lead most at risk of going
    // stale at the bottom of the pile - the opposite of the order to work in.
    for (const s of STATUSES) {
      map[s].sort((a, b) =>
        OLDEST_FIRST.has(s)
          ? a.created_at.localeCompare(b.created_at)
          : b.created_at.localeCompare(a.created_at),
      );
    }
    return map;
  }, [quotes]);

  // Recomputed per render rather than memoised: this is only ever compared
  // against dates, so it costs nothing and can't go stale in a long-lived tab.
  const today = new Date().toISOString().slice(0, 10);

  // The single oldest lead nobody has quoted. Pinned above the board so there
  // is one obvious answer to "what now" rather than seven columns of options.
  const nextUp = useMemo(() => {
    const stale = quotes
      .filter((q) => isUntouched(q, today))
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    const oldest = stale[0];
    if (!oldest || hoursSince(oldest.created_at) < 12) return null;
    return { quote: oldest, waiting: stale.length };
  }, [quotes, today]);

  // Owners get the same picture per contractor: who is sitting on work. Only
  // counts leads past the 12-hour nudge, so a morning's fresh leads don't
  // read as a backlog.
  const staleByContractor = useMemo(() => {
    if (role !== "owner") return [];
    const counts = new Map<string, number>();
    for (const q of quotes) {
      if (!isUntouched(q, today) || hoursSince(q.created_at) < 12) continue;
      const key = q.assigned_to ?? "";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([id, n]) => ({ id, name: id ? (nameMap[id] ?? t.pipeline.crew) : t.pipeline.unassigned, n }))
      .sort((a, b) => b.n - a.n);
  }, [quotes, role, nameMap, t, today]);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  function move(id: string, status: Status) {
    const prev = quotes;
    const target = prev.find((q) => q.id === id);
    if (!target || target.status === status) return;
    setQuotes((qs) => qs.map((q) => (q.id === id ? { ...q, status } : q)));
    startTransition(async () => {
      const res = await moveQuote(id, status);
      if (!res.ok) {
        setQuotes(prev);
        flash(res.error ?? t.pipeline.errMove);
      } else {
        router.refresh();
      }
    });
  }

  function remove(id: string, name: string) {
    if (!window.confirm(fill(t.pipeline.deleteConfirm, { name }))) return;
    const prev = quotes;
    setQuotes((qs) => qs.filter((q) => q.id !== id));
    startTransition(async () => {
      const res = await deleteQuote(id);
      if (!res.ok) {
        setQuotes(prev);
        flash(res.error ?? t.pipeline.errDelete);
      } else {
        flash(t.pipeline.deleted);
        router.refresh();
      }
    });
  }

  function assign(id: string, contractorId: string) {
    const prev = quotes;
    setQuotes((qs) =>
      qs.map((q) => (q.id === id ? { ...q, assigned_to: contractorId || null } : q)),
    );
    startTransition(async () => {
      const res = await assignQuote(id, contractorId);
      if (!res.ok) {
        setQuotes(prev);
        flash(res.error ?? t.pipeline.errAssign);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div className="kb">
      {toast && <div className="kb-toast">{toast}</div>}

      {/* One job, named, at the top. A board tells you everything at once,
          which is a good way to see the shape of the week and a bad way to
          decide what to touch first. */}
      {nextUp && (
        <button type="button" className="kb-next" onClick={() => router.push(cardHref(nextUp.quote))}>
          <span className="kb-next-label">{t.pipeline.nextUp}</span>
          <span className="kb-next-name">{nextUp.quote.name}</span>
          <span className="kb-next-meta">
            {nextUp.quote.service || t.pipeline.serviceTBD}
            {" · "}
            {fill(t.pipeline.waitingFor, { age: ageBadge(nextUp.quote, today)?.text ?? "" })}
            {nextUp.waiting > 1 ? ` · ${fill(t.pipeline.alsoWaiting, { n: nextUp.waiting - 1 })}` : ""}
          </span>
        </button>
      )}

      {staleByContractor.length > 0 && (
        <div className="kb-stale">
          <span className="kb-stale-label">{t.pipeline.sittingOnWork}</span>
          {staleByContractor.map((s) => (
            <span key={s.id || "unassigned"} className="kb-stale-item">
              {s.name} <strong>{s.n}</strong>
            </span>
          ))}
        </div>
      )}

      <div className="kb-cols">
        {STATUSES.map((status) => {
          const cards = byStatus[status];
          return (
            <section
              key={status}
              className={`kb-col${overCol === status ? " kb-col-over" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setOverCol(status);
              }}
              onDragLeave={() => setOverCol((c) => (c === status ? null : c))}
              onDrop={(e) => {
                e.preventDefault();
                setOverCol(null);
                const id = e.dataTransfer.getData("text/plain") || dragId;
                if (id) move(id, status);
              }}
            >
              <header className={`kb-col-head kb-accent-${status}`}>
                <span className="kb-col-title">{statusLabel(status)}</span>
                <span className="kb-col-count">{cards.length}</span>
              </header>

              <div className="kb-col-body">
                {cards.length === 0 && <p className="kb-empty">{t.pipeline.dropHere}</p>}
                {cards.map((q) => (
                  <article
                    key={q.id}
                    className={`kb-card${dragId === q.id ? " kb-card-dragging" : ""}`}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", q.id);
                      e.dataTransfer.effectAllowed = "move";
                      setDragId(q.id);
                    }}
                    onDragEnd={() => setDragId(null)}
                    onClick={() => router.push(cardHref(q))}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") router.push(cardHref(q));
                    }}
                  >
                    <div className="kb-card-top">
                      <h3 className="kb-card-name">{q.name}</h3>
                      {/* How long this has gone unquoted, where the price
                          would otherwise sit - an unquoted lead has no price
                          to show, so the two never collide. */}
                      {(() => {
                        const age = ageBadge(q, today);
                        if (age) return <span className={`kb-age kb-age-${age.tone}`}>{age.text}</span>;
                        return q.quote_amount != null ? (
                          <span className="kb-card-amount">{money(q.quote_amount)}</span>
                        ) : null;
                      })()}
                    </div>
                    <p className="kb-card-sub">
                      {q.service || t.pipeline.serviceTBD}
                      {q.city ? ` \u00b7 ${q.city}` : ""}
                    </p>
                    {(() => {
                      const kind = typeLabel(q, t);
                      const jobDate = shortDate(q.scheduled_date, locale);
                      const visitDate = shortDate(visitDateOf(q), locale);
                      return (
                        <div className="kb-card-meta">
                          <span className={`kb-pill kb-pill-${kind.cls}`}>{kind.text}</span>
                          {jobDate && (
                            <span className="kb-pill kb-pill-date">
                              {t.pipeline.pillJob} {jobDate}
                              {q.scheduled_time ? ` ${q.scheduled_time}` : ""}
                            </span>
                          )}
                          {!jobDate && visitDate && (
                            <span className="kb-pill kb-pill-date">
                              {t.pipeline.pillVisit} {visitDate}
                              {q.visit_time ? ` ${q.visit_time}` : ""}
                            </span>
                          )}
                          {q.status === "scheduled" &&
                            (q.confirmed_at ? (
                              <span className="kb-pill kb-pill-confirmed">{t.pipeline.pillConfirmed}</span>
                            ) : (
                              <span className="kb-pill kb-pill-unconfirmed">{t.pipeline.pillUnconfirmed}</span>
                            ))}
                          {q.view_count > 0 && (
                            <span className="kb-pill kb-pill-view">
                              {t.pipeline.pillViewed} {q.view_count}x
                            </span>
                          )}
                          {q.assigned_to && <span className="kb-pill kb-pill-assigned">{nameMap[q.assigned_to] ?? t.pipeline.crew}</span>}
                        </div>
                      );
                    })()}

                    <div className="kb-quick" onClick={(e) => e.stopPropagation()}>
                      <a href={telHref(q.phone)} className="kb-quick-btn" aria-label={`${t.calendar.call} ${q.name}`}>
                        {t.calendar.call}
                      </a>
                      <a href={smsHref(q.phone)} className="kb-quick-btn" aria-label={`${t.pipeline.textBtn} ${q.name}`}>
                        {t.pipeline.textBtn}
                      </a>
                      {q.address && (
                        <a href={mapsHref(q.address)} target="_blank" rel="noreferrer" className="kb-quick-btn">
                          {t.calendar.map}
                        </a>
                      )}
                    </div>

                    <div className="kb-card-actions" onClick={(e) => e.stopPropagation()}>
                      <label className="kb-move">
                        <span>{t.pipeline.move}</span>
                        <select value={q.status} onChange={(e) => move(q.id, e.target.value as Status)}>
                          {STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {statusLabel(s)}
                            </option>
                          ))}
                        </select>
                      </label>
                      {role === "owner" && (
                        <label className="kb-move">
                          <span>{t.pipeline.crew}</span>
                          <select value={q.assigned_to ?? ""} onChange={(e) => assign(q.id, e.target.value)}>
                            <option value="">{t.pipeline.unassignedCard}</option>
                            {contractors.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      {role === "owner" && (
                        <button
                          type="button"
                          className="kb-delete-btn"
                          aria-label={`${t.pipeline.deleteLead} ${q.name}`}
                          onClick={() => remove(q.id, q.name)}
                        >
                          {t.pipeline.deleteLead}
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
