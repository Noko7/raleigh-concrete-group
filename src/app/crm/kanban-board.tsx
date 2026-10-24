"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { ymdInDays } from "@/lib/crm/clock";
import { dollars, STATUSES, VISIT_GRACE_DAYS, visitDateOf, type Status } from "@/lib/crm/constants";
import { dict, fill, intlLocale, tr, type Dict, type Locale } from "@/lib/crm/i18n";
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
  /** Owner only; 0 for everyone else. */
  crew_views: number;
  /** Owner only: opens after it was marked Lost. */
  crew_closed_views: number;
  quote_type: string | null;
  created_at: string;
  scheduled_date: string | null;
  scheduled_time: string | null;
  visit_date: string | null;
  visit_time: string | null;
  job_token: string | null;
  /** Practice lead: real everywhere except the Money page. */
  is_test: boolean;
};

function shortDate(ymd: string | null, locale: Locale): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return "";
  return new Date(`${ymd}T00:00:00`).toLocaleDateString(intlLocale(locale), {
    month: "short",
    day: "numeric",
  });
}

// Unquoted AND nobody booked to see it. Status alone is wrong: an in-person lead legitimately stays "new"
// until its visit. After the visit the crew get VISIT_GRACE_DAYS to send the price.
function isUntouched(q: BoardQuote, graceFrom: string): boolean {
  if (q.status !== "new") return false;
  const booked = visitDateOf(q);
  if (booked && booked >= graceFrom) return false;
  return true;
}

const hoursSince = (iso: string) => (Date.now() - new Date(iso).getTime()) / 3_600_000;

// Amber from 12h; red from 48h, when the "lead needs attention" text goes (STALE_LEAD_HOURS).
function ageBadge(q: BoardQuote, graceFrom: string): { text: string; tone: "warn" | "late" } | null {
  if (!isUntouched(q, graceFrom)) return null;
  const h = hoursSince(q.created_at);
  if (h < 12) return null;
  const text = h < 48 ? `${Math.floor(h)}h` : `${Math.floor(h / 24)}d`;
  return { text, tone: h < 48 ? "warn" : "late" };
}

// Columns where the oldest is the most urgent. Finished work stays newest-first.
const OLDEST_FIRST: ReadonlySet<Status> = new Set(["new", "quoted", "approved", "scheduled"]);

// Null is "In-person quote": everything else (visitDateOf, calendar, reminders) treats null as in-person.
function typeLabel(q: BoardQuote, t: Dict): { text: string; cls: string } {
  if (q.quote_type === "online") return { text: t.pipeline.typeOnline, cls: "online" };
  if (q.quote_type === "plans") return { text: t.pipeline.typePlans, cls: "plans" };
  return { text: t.pipeline.typeInPerson, cls: "inperson" };
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
  return dollars(n) ?? "";
}

export function KanbanBoard({ base, role, initialQuotes, contractors, nameMap, locale }: Props) {
  const t = dict(locale);
  // Contractors get their own job page (the URL their texts link to); owners get the full editor.
  const cardHref = (q: BoardQuote) =>
    role === "contractor" && q.job_token ? `/job/${q.job_token}` : `${base}/quotes/${q.id}`;
  // Column headings and the Move menu read from the translated status names.
  const statusLabel = (s: Status) => t.status[s];
  const router = useRouter();
  const [quotes, setQuotes] = useState<BoardQuote[]>(initialQuotes);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<Status | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // Phone only: the single stage shown. Desktop renders every column.
  const [stage, setStage] = useState<Status>("new");
  // Phone only; on desktop the controls always show (CSS decides), so the DOM is the same.
  const [openCard, setOpenCard] = useState<string | null>(null);

  // Adopt fresh server data without clobbering in-flight optimistic edits: re-sync only when the snapshot changes.
  const initialSig = useMemo(
    () => initialQuotes.map((q) => `${q.id}:${q.status}:${q.assigned_to ?? ""}:${q.quote_amount ?? ""}`).join("|"),
    [initialQuotes],
  );
  useEffect(() => {
    setQuotes(initialQuotes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSig]);

  // Refresh every 20s so accepted/booked quotes move on their own. Paused while dragging, saving, or the tab
  // is hidden (each refresh is a full server render); a hidden tab refreshes once on return.
  useEffect(() => {
    const tick = () => {
      if (document.hidden || dragId || isPending) return;
      router.refresh();
    };
    const t = setInterval(tick, 20000);
    const onShow = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [dragId, isPending, router]);

  const byStatus = useMemo(() => {
    // From STATUSES so a new stage can't miss a column.
    const map = Object.fromEntries(STATUSES.map((s) => [s, [] as BoardQuote[]])) as Record<Status, BoardQuote[]>;
    for (const q of quotes) map[q.status]?.push(q);
    // The server returns newest-first, which buries the lead most at risk of going stale.
    for (const s of STATUSES) {
      map[s].sort((a, b) =>
        OLDEST_FIRST.has(s)
          ? a.created_at.localeCompare(b.created_at)
          : b.created_at.localeCompare(a.created_at),
      );
    }
    return map;
  }, [quotes]);

  // Earliest visit date that still holds a lead back (see isUntouched). Per render so it can't go stale.
  const graceFrom = ymdInDays(-VISIT_GRACE_DAYS);

  // Pinned above the board: one obvious answer to "what now".
  const nextUp = useMemo(() => {
    const stale = quotes
      .filter((q) => isUntouched(q, graceFrom))
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    const oldest = stale[0];
    if (!oldest || hoursSince(oldest.created_at) < 12) return null;
    return { quote: oldest, waiting: stale.length };
  }, [quotes, graceFrom]);

  // Only leads past 12h, so a morning's fresh leads don't read as a backlog.
  const staleByContractor = useMemo(() => {
    if (role !== "owner") return [];
    const counts = new Map<string, number>();
    for (const q of quotes) {
      if (!isUntouched(q, graceFrom) || hoursSince(q.created_at) < 12) continue;
      const key = q.assigned_to ?? "";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([id, n]) => ({ id, name: id ? (nameMap[id] ?? t.pipeline.crew) : t.pipeline.unassigned, n }))
      .sort((a, b) => b.n - a.n);
  }, [quotes, role, nameMap, t, graceFrom]);

  // Start on the first non-empty stage, on first load only, so picking an empty stage doesn't bounce back.
  const [stagePicked, setStagePicked] = useState(false);
  useEffect(() => {
    if (stagePicked || quotes.length === 0) return;
    const firstBusy = STATUSES.find((sx) => quotes.some((q) => q.status === sx));
    if (firstBusy) setStage(firstBusy);
    setStagePicked(true);
  }, [quotes, stagePicked]);

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
        flash(tr(locale, res.error) ?? t.pipeline.errMove);
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
        flash(tr(locale, res.error) ?? t.pipeline.errDelete);
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
        flash(tr(locale, res.error) ?? t.pipeline.errAssign);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div className="kb">
      {toast && <div className="kb-toast">{toast}</div>}

      {nextUp && (
        <button type="button" className="kb-next" onClick={() => router.push(cardHref(nextUp.quote))}>
          <span className="kb-next-label">{t.pipeline.nextUp}</span>
          <span className="kb-next-name">{nextUp.quote.name}</span>
          <span className="kb-next-meta">
            {nextUp.quote.service || t.pipeline.serviceTBD}
            {" · "}
            {fill(t.pipeline.waitingFor, { age: ageBadge(nextUp.quote, graceFrom)?.text ?? "" })}
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

      {/* Phone only. Counts on the chips replace what the column headings said. */}
      <div className="kb-stages" role="group" aria-label={t.pipeline.stagePicker}>
        {STATUSES.map((sx) => (
          <button
            key={sx}
            type="button"
            className={`kb-stage${stage === sx ? " kb-stage-on" : ""} kb-accent-${sx}`}
            onClick={() => {
              setStage(sx);
              setStagePicked(true);
            }}
            aria-pressed={stage === sx}
          >
            {statusLabel(sx)}
            <span className="kb-stage-n">{byStatus[sx].length}</span>
          </button>
        ))}
      </div>

      <div className="kb-cols">
        {STATUSES.map((status) => {
          const cards = byStatus[status];
          return (
            <section
              key={status}
              className={`kb-col${overCol === status ? " kb-col-over" : ""}${
                stage === status ? " kb-col-active" : ""
              }`}
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
                {cards.length === 0 && (
                  <p className="kb-empty">
                    {/* No drag and drop on a phone. */}
                    <span className="kb-wide-only">{t.pipeline.dropHere}</span>
                    <span className="kb-narrow-only">{t.pipeline.noneInStage}</span>
                  </p>
                )}
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
                      {/* Where the price would sit: an unquoted lead has none, so they never collide. */}
                      {(() => {
                        const age = ageBadge(q, graceFrom);
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
                    {/*
                      Pills are kept to a minimum or they get skimmed:
                      1. The date pill names the appointment type, so the type pill is dropped for the in-person default.
                         Online and From-plans stay: they change what you'd do next.
                      2. No Confirmed / Not confirmed: the column already says Scheduled, and the crew page uses "Not
                         confirmed" for something else.
                      3. Viewed and assignee stay: nothing else on screen carries them.
                    */}
                    {(() => {
                      const kind = typeLabel(q, t);
                      const jobDate = shortDate(q.scheduled_date, locale);
                      const visitDate = shortDate(visitDateOf(q), locale);
                      const dated = Boolean(jobDate || visitDate);
                      const showType = !dated || kind.cls !== "inperson";
                      return (
                        <div className="kb-card-meta">
                          {/* First: what the row IS changes how every other pill reads. */}
                          {q.is_test && <span className="kb-pill kb-pill-test">{t.misc.test}</span>}
                          {showType && <span className={`kb-pill kb-pill-${kind.cls}`}>{kind.text}</span>}
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
                          {q.view_count > 0 && (
                            <span className="kb-pill kb-pill-view">
                              {t.pipeline.pillViewed} {q.view_count}x
                            </span>
                          )}
                          {q.assigned_to && (
                            <span className="kb-pill kb-pill-assigned">
                              {nameMap[q.assigned_to] ?? t.pipeline.crew}
                              {q.crew_views > 0 && ` · ${t.pipeline.pillViewed} ${q.crew_views}x`}
                            </span>
                          )}
                          {q.crew_closed_views > 0 && (
                            <span className="kb-pill kb-pill-alert">
                              {fill(t.pipeline.pillTriedAfterLost, { n: String(q.crew_closed_views) })}
                            </span>
                          )}
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

                    <div className="kb-card-tools" onClick={(e) => e.stopPropagation()}>
                      {/* Phone only: controls fold away so the list stays a list. */}
                      <button
                        type="button"
                        className="kb-more-btn"
                        aria-expanded={openCard === q.id}
                        onClick={() => setOpenCard((c) => (c === q.id ? null : q.id))}
                      >
                        {t.pipeline.change}
                      </button>

                      <div className="kb-card-actions" data-open={openCard === q.id}>
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
