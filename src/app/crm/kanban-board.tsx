"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { STATUSES, STATUS_LABELS, type Status } from "@/lib/crm/constants";
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
  visit_date: string | null;
  visit_time: string | null;
  confirmed_at: string | null;
};

function shortDate(ymd: string | null): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return "";
  return new Date(`${ymd}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// One clear label per lead type so a card reads at a glance.
function typeLabel(q: BoardQuote): { text: string; cls: string } {
  if (q.quote_type === "online") return { text: "Online quote", cls: "online" };
  if (q.quote_type === "inperson") return { text: "In-person quote", cls: "inperson" };
  return { text: "Lead", cls: "inperson" };
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
};

function money(n: number | null): string {
  return n == null ? "" : `$${Number(n).toLocaleString("en-US")}`;
}

export function KanbanBoard({ base, role, initialQuotes, contractors, nameMap }: Props) {
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
    const map: Record<Status, BoardQuote[]> = {
      new: [], quoted: [], scheduled: [], completed: [], paid: [], lost: [],
    };
    for (const q of quotes) map[q.status]?.push(q);
    return map;
  }, [quotes]);

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
        flash(res.error ?? "Could not move that quote.");
      } else {
        router.refresh();
      }
    });
  }

  function remove(id: string, name: string) {
    if (!window.confirm(`Delete ${name}'s lead from the pipeline? You can restore it later from Archived.`)) return;
    const prev = quotes;
    setQuotes((qs) => qs.filter((q) => q.id !== id));
    startTransition(async () => {
      const res = await deleteQuote(id);
      if (!res.ok) {
        setQuotes(prev);
        flash(res.error ?? "Could not delete that lead.");
      } else {
        flash("Lead deleted. Restore it anytime from Archived.");
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
        flash(res.error ?? "Could not assign.");
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div className="kb">
      {toast && <div className="kb-toast">{toast}</div>}
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
                <span className="kb-col-title">{STATUS_LABELS[status]}</span>
                <span className="kb-col-count">{cards.length}</span>
              </header>

              <div className="kb-col-body">
                {cards.length === 0 && <p className="kb-empty">Drop here</p>}
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
                    onClick={() => router.push(`${base}/quotes/${q.id}`)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") router.push(`${base}/quotes/${q.id}`);
                    }}
                  >
                    <div className="kb-card-top">
                      <h3 className="kb-card-name">{q.name}</h3>
                      {q.quote_amount != null && <span className="kb-card-amount">{money(q.quote_amount)}</span>}
                    </div>
                    <p className="kb-card-sub">
                      {q.service || "Service TBD"}
                      {q.city ? ` \u00b7 ${q.city}` : ""}
                    </p>
                    {(() => {
                      const t = typeLabel(q);
                      const jobDate = shortDate(q.scheduled_date);
                      const visitDate = shortDate(q.visit_date);
                      return (
                        <div className="kb-card-meta">
                          <span className={`kb-pill kb-pill-${t.cls}`}>{t.text}</span>
                          {jobDate && <span className="kb-pill kb-pill-date">Job {jobDate}</span>}
                          {!jobDate && visitDate && (
                            <span className="kb-pill kb-pill-date">
                              Visit {visitDate}
                              {q.visit_time ? ` ${q.visit_time}` : ""}
                            </span>
                          )}
                          {q.confirmed_at && <span className="kb-pill kb-pill-confirmed">Confirmed</span>}
                          {q.view_count > 0 && <span className="kb-pill kb-pill-view">Viewed {q.view_count}x</span>}
                          {q.assigned_to && <span className="kb-pill kb-pill-assigned">{nameMap[q.assigned_to] ?? "Assigned"}</span>}
                        </div>
                      );
                    })()}

                    <div className="kb-quick" onClick={(e) => e.stopPropagation()}>
                      <a href={telHref(q.phone)} className="kb-quick-btn" aria-label={`Call ${q.name}`}>
                        Call
                      </a>
                      <a href={smsHref(q.phone)} className="kb-quick-btn" aria-label={`Text ${q.name}`}>
                        Text
                      </a>
                      {q.address && (
                        <a href={mapsHref(q.address)} target="_blank" rel="noreferrer" className="kb-quick-btn">
                          Map
                        </a>
                      )}
                    </div>

                    <div className="kb-card-actions" onClick={(e) => e.stopPropagation()}>
                      <label className="kb-move">
                        <span>Move</span>
                        <select value={q.status} onChange={(e) => move(q.id, e.target.value as Status)}>
                          {STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {STATUS_LABELS[s]}
                            </option>
                          ))}
                        </select>
                      </label>
                      {role === "owner" && (
                        <label className="kb-move">
                          <span>Crew</span>
                          <select value={q.assigned_to ?? ""} onChange={(e) => assign(q.id, e.target.value)}>
                            <option value="">Unassigned</option>
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
                          aria-label={`Delete ${q.name}'s lead`}
                          onClick={() => remove(q.id, q.name)}
                        >
                          Delete
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
