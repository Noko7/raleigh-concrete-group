"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { STATUS_LABELS, VISIT_TIME_SLOTS, type Status } from "@/lib/crm/constants";
import { START_TIMES } from "@/app/crm/quotes/[id]/schedule-card";
import { deleteEvent, moveEvent, type CalActionState } from "./actions";

export type CalKind = "job" | "inperson" | "online";

export type CalEvent = {
  id: string;
  date: string; // yyyy-mm-dd
  kind: CalKind;
  title: string;
  time: string | null;
  phone: string;
  service: string | null;
  address: string | null;
  status: string;
};

const KIND_LABEL: Record<CalKind, string> = {
  job: "Job",
  inperson: "In-person quote",
  online: "Online quote",
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
// Both spellings render; CSS picks one. A single letter is all that fits over a
// 45px column, and "Sun" is what you want when the columns are 140px wide.
const DOW: [string, string][] = [
  ["Sun", "S"], ["Mon", "M"], ["Tue", "T"], ["Wed", "W"], ["Thu", "T"], ["Fri", "F"], ["Sat", "S"],
];

// How many chips fit in a month cell before it collapses into "+N more".
const MAX_CHIPS = 3;
const VIEW_KEY = "rcg-cal-view";

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function longDate(s: string): string {
  return new Date(`${s}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00`).getTime();
  const b = new Date(`${to}T00:00:00`).getTime();
  return Math.round((b - a) / 86_400_000);
}

// "Today", "Tomorrow", then the date. On a job site the only questions are "is
// this now" and "is this next", so those two get words instead of a date.
function dayHeading(date: string, todayStr: string): { main: string; sub: string } {
  const diff = daysBetween(todayStr, date);
  const d = new Date(`${date}T00:00:00`);
  const full = d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  if (diff === 0) return { main: "Today", sub: full };
  if (diff === 1) return { main: "Tomorrow", sub: full };
  return { main: full, sub: diff < 7 ? `in ${diff} days` : "" };
}

// A job's date lives in a different column from a visit's, so the server needs
// to know which one it's moving.
const serverKind = (k: CalKind) => (k === "job" ? "job" : "visit");

// Sort key: timed appointments in clock order, untimed last.
function timeKey(t: string | null): number {
  if (!t) return 9999;
  const m = t.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!m) return 9999;
  let h = Number(m[1]);
  const ap = m[3]?.toUpperCase();
  if (ap === "PM" && h < 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  return h * 60 + Number(m[2]);
}

const telHref = (p: string) => `tel:${p.replace(/[^0-9+]/g, "")}`;
const mapHref = (a: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a)}`;

export function CalendarView({ events, base }: { events: CalEvent[]; base: string }) {
  const router = useRouter();
  const today = new Date();
  const todayStr = ymd(today);

  // List is the default: this is used in the field far more than at a desk, and
  // a 7-column grid on a phone gives you 45px cells nobody can read or tap. A
  // wide screen flips to Month on first load, then whatever you last chose.
  const [view, setView] = useState<"list" | "month">("list");
  const [cursor, setCursor] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const [show, setShow] = useState<Record<CalKind, boolean>>({ job: true, inperson: true, online: true });

  const [selected, setSelected] = useState<CalEvent | null>(null);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overDay, setOverDay] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [moveState, moveAction, moving] = useActionState<CalActionState, FormData>(moveEvent, { ok: false });
  const [delState, delAction, deleting] = useActionState<CalActionState, FormData>(deleteEvent, { ok: false });
  const busy = moving || deleting;

  // Applied after mount, so the server and the first client render agree.
  useEffect(() => {
    const saved = window.localStorage.getItem(VIEW_KEY);
    if (saved === "list" || saved === "month") setView(saved);
    else if (window.matchMedia("(min-width: 900px)").matches) setView("month");
  }, []);

  function pickView(v: "list" | "month") {
    setView(v);
    try {
      window.localStorage.setItem(VIEW_KEY, v);
    } catch {
      // Private mode: the choice just doesn't persist, which is fine.
    }
  }

  useEffect(() => {
    const s = moveState.ok ? moveState.message : moveState.error;
    if (s) {
      setToast(s);
      if (moveState.ok) setSelected(null);
    }
  }, [moveState]);

  useEffect(() => {
    const s = delState.ok ? delState.message : delState.error;
    if (s) {
      setToast(s);
      if (delState.ok) setSelected(null);
    }
  }, [delState]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setSelected(null);
      setOpenDay(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const visible = useMemo(() => events.filter((e) => show[e.kind]), [events, show]);

  const byDate = useMemo(() => {
    const map = new Map<string, CalEvent[]>();
    for (const e of visible) {
      const list = map.get(e.date) ?? [];
      list.push(e);
      map.set(e.date, list);
    }
    for (const list of map.values()) list.sort((a, b) => timeKey(a.time) - timeKey(b.time));
    return map;
  }, [visible]);

  // The agenda: everything from today forward, grouped by day. Past work lives
  // in Month view, so the list never makes you scroll through history to reach
  // the thing you're driving to next.
  const agenda = useMemo(() => {
    const days = [...byDate.keys()].filter((d) => d >= todayStr).sort();
    return days.map((d) => ({ date: d, items: byDate.get(d) ?? [] }));
  }, [byDate, todayStr]);

  const cells = useMemo(() => {
    const first = new Date(cursor.y, cursor.m, 1);
    const start = new Date(first);
    start.setDate(1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [cursor]);

  function shift(delta: number) {
    setCursor((c) => {
      const m = c.m + delta;
      return { y: c.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 };
    });
  }

  function drop(day: string) {
    const ev = events.find((e) => e.id === dragId);
    setDragId(null);
    setOverDay(null);
    if (!ev || ev.date === day || busy) return;
    const fd = new FormData();
    fd.set("id", ev.id);
    fd.set("kind", serverKind(ev.kind));
    fd.set("date", day);
    fd.set("time", ev.time ?? (ev.kind === "job" ? "9:00 AM" : ""));
    moveAction(fd);
  }

  const dayEventsFor = (key: string) => byDate.get(key) ?? [];

  return (
    <div className="cal">
      {toast && (
        <div className={`cal-toast${moveState.error || delState.error ? " cal-toast-bad" : ""}`} role="status">
          {toast}
        </div>
      )}

      <div className="cal-bar">
        <div className="cal-views" role="group" aria-label="Calendar view">
          <button
            type="button"
            aria-pressed={view === "list"}
            className={`cal-view${view === "list" ? " cal-view-on" : ""}`}
            onClick={() => pickView("list")}
          >
            Schedule
          </button>
          <button
            type="button"
            aria-pressed={view === "month"}
            className={`cal-view${view === "month" ? " cal-view-on" : ""}`}
            onClick={() => pickView("month")}
          >
            Month
          </button>
        </div>

        {view === "month" && (
          <div className="cal-month-nav">
            <button type="button" className="cal-nav" onClick={() => shift(-1)} aria-label="Previous month">
              ‹
            </button>
            <strong className="cal-month-name">
              {MONTHS[cursor.m]} {cursor.y}
            </strong>
            <button type="button" className="cal-nav" onClick={() => shift(1)} aria-label="Next month">
              ›
            </button>
            <button
              type="button"
              className="cal-nav cal-nav-today"
              onClick={() => setCursor({ y: today.getFullYear(), m: today.getMonth() })}
            >
              Today
            </button>
          </div>
        )}
      </div>

      <div className="cal-filters">
        {(["job", "inperson", "online"] as CalKind[]).map((k) => (
          <button
            key={k}
            type="button"
            className={`cal-filter cal-filter-${k}${show[k] ? " cal-filter-on" : ""}`}
            onClick={() => setShow((s) => ({ ...s, [k]: !s[k] }))}
            aria-pressed={show[k]}
          >
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>

      {view === "list" ? (
        <div className={`cal-agenda${busy ? " cal-busy" : ""}`}>
          {agenda.length === 0 ? (
            <p className="cal-empty">Nothing scheduled. Booked jobs and quote visits show up here.</p>
          ) : (
            agenda.map(({ date, items }) => {
              const h = dayHeading(date, todayStr);
              return (
                <section key={date} className="cal-day">
                  <h3 className={`cal-day-head${date === todayStr ? " cal-day-today" : ""}`}>
                    <span className="cal-day-main">{h.main}</span>
                    {h.sub && <span className="cal-day-sub">{h.sub}</span>}
                  </h3>

                  {items.map((e) => (
                    <article key={e.id + e.kind} className={`cal-row cal-row-${e.kind}`}>
                      <button type="button" className="cal-row-main" onClick={() => setSelected(e)}>
                        <span className="cal-row-time">{e.time ?? "All day"}</span>
                        <span className="cal-row-body">
                          <span className="cal-row-name">{e.title}</span>
                          <span className="cal-row-kind">{KIND_LABEL[e.kind]}</span>
                          {e.address && <span className="cal-row-addr">{e.address}</span>}
                        </span>
                      </button>
                      <div className="cal-row-acts">
                        <a href={telHref(e.phone)} className="cal-act" aria-label={`Call ${e.title}`}>
                          Call
                        </a>
                        {e.address && (
                          <a href={mapHref(e.address)} target="_blank" rel="noreferrer" className="cal-act">
                            Map
                          </a>
                        )}
                      </div>
                    </article>
                  ))}
                </section>
              );
            })
          )}
        </div>
      ) : (
        <>
          <div className="cal-grid cal-dow">
            {DOW.map(([full, short], i) => (
              <div key={i} className="cal-dow-cell">
                <span className="cal-dow-full">{full}</span>
                <span className="cal-dow-short">{short}</span>
              </div>
            ))}
          </div>

          <div className={`cal-grid${busy ? " cal-busy" : ""}`}>
            {cells.map((d) => {
              const key = ymd(d);
              const inMonth = d.getMonth() === cursor.m;
              const weekend = d.getDay() === 0 || d.getDay() === 6;
              const dayEvents = dayEventsFor(key);
              const chips = dayEvents.slice(0, MAX_CHIPS);
              const hidden = dayEvents.length - chips.length;

              return (
                <div
                  key={key}
                  className={[
                    "cal-cell",
                    inMonth ? "" : "cal-cell-dim",
                    weekend ? "cal-cell-weekend" : "",
                    key === todayStr ? "cal-cell-today" : "",
                    overDay === key ? "cal-cell-over" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setOverDay(key);
                  }}
                  onDragLeave={() => setOverDay((c) => (c === key ? null : c))}
                  onDrop={(e) => {
                    e.preventDefault();
                    drop(key);
                  }}
                >
                  <span className="cal-daynum">{d.getDate()}</span>

                  {/* Wide screens get readable chips. Narrow screens get dots
                      and open the whole day in a sheet, because a name never
                      fits in a 45px cell and a half-rendered one is worse than
                      an honest dot. */}
                  <div className="cal-events">
                    {chips.map((e) => (
                      <button
                        key={e.id + e.kind}
                        type="button"
                        className={`cal-chip cal-chip-${e.kind}${dragId === e.id ? " cal-chip-dragging" : ""}`}
                        draggable={!busy}
                        onDragStart={(ev) => {
                          ev.dataTransfer.setData("text/plain", e.id);
                          ev.dataTransfer.effectAllowed = "move";
                          setDragId(e.id);
                        }}
                        onDragEnd={() => setDragId(null)}
                        onClick={() => setSelected(e)}
                        title={`${KIND_LABEL[e.kind]}: ${e.title}${e.time ? ` at ${e.time}` : ""}`}
                      >
                        {e.time && <span className="cal-chip-time">{e.time}</span>}
                        <span className="cal-chip-title">{e.title}</span>
                      </button>
                    ))}
                    {hidden > 0 && (
                      <button type="button" className="cal-more" onClick={() => setOpenDay(key)}>
                        +{hidden} more
                      </button>
                    )}
                  </div>

                  {dayEvents.length > 0 && (
                    <button
                      type="button"
                      className="cal-dots"
                      onClick={() => setOpenDay(key)}
                      aria-label={`${dayEvents.length} on ${longDate(key)}`}
                    >
                      {dayEvents.slice(0, 4).map((e, i) => (
                        <i key={e.id + e.kind + i} className={`cal-dot cal-dot-${e.kind}`} />
                      ))}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <p className="cal-help crm-muted crm-sm">Drag an appointment to another day to reschedule it.</p>
        </>
      )}

      {openDay && (
        <div className="cal-scrim" onClick={() => setOpenDay(null)} role="presentation">
          <div className="cal-daypanel" onClick={(e) => e.stopPropagation()}>
            <div className="cal-panel-head">
              <h3>{longDate(openDay)}</h3>
              <button type="button" className="cal-panel-x" onClick={() => setOpenDay(null)} aria-label="Close">
                ×
              </button>
            </div>
            <div className="cal-daylist">
              {dayEventsFor(openDay).map((e) => (
                <article key={e.id + e.kind} className={`cal-row cal-row-${e.kind}`}>
                  <button
                    type="button"
                    className="cal-row-main"
                    onClick={() => {
                      setSelected(e);
                      setOpenDay(null);
                    }}
                  >
                    <span className="cal-row-time">{e.time ?? "All day"}</span>
                    <span className="cal-row-body">
                      <span className="cal-row-name">{e.title}</span>
                      <span className="cal-row-kind">{KIND_LABEL[e.kind]}</span>
                    </span>
                  </button>
                </article>
              ))}
            </div>
          </div>
        </div>
      )}

      {selected && (
        <EventPanel
          event={selected}
          base={base}
          busy={busy}
          error={moveState.error || delState.error}
          onClose={() => setSelected(null)}
          onOpen={() => router.push(`${base}/quotes/${selected.id}`)}
          moveAction={moveAction}
          delAction={delAction}
        />
      )}
    </div>
  );
}

/* ── The detail panel: what this appointment is, and the three things you can
      do to it. States what the customer will be told before anything
      irreversible happens. ──────────────────────────────────────────────── */
function EventPanel({
  event,
  base,
  busy,
  error,
  onClose,
  onOpen,
  moveAction,
  delAction,
}: {
  event: CalEvent;
  base: string;
  busy: boolean;
  error?: string;
  onClose: () => void;
  onOpen: () => void;
  moveAction: (fd: FormData) => void;
  delAction: (fd: FormData) => void;
}) {
  const isJob = event.kind === "job";
  const times = isJob ? START_TIMES : VISIT_TIME_SLOTS;

  const [mode, setMode] = useState<"view" | "move" | "delete">("view");
  const [date, setDate] = useState(event.date);
  const [time, setTime] = useState(event.time ?? (isJob ? "9:00 AM" : times[0]));
  const [notify, setNotify] = useState(true);

  return (
    <div className="cal-scrim" onClick={onClose} role="presentation">
      <aside className="cal-panel" onClick={(e) => e.stopPropagation()} aria-label="Appointment">
        <div className="cal-panel-head">
          <div>
            <span className={`cal-panel-kind cal-bg-${event.kind}`}>{KIND_LABEL[event.kind]}</span>
            <h3>{event.title}</h3>
          </div>
          <button type="button" className="cal-panel-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <p className="cal-panel-when">
          {longDate(event.date)}
          {event.time ? ` at ${event.time}` : ""}
        </p>

        {mode === "view" && (
          <>
            <div className="cal-panel-quick">
              <a href={telHref(event.phone)} className="crm-btn crm-btn-ghost">
                Call {event.phone}
              </a>
              {event.address && (
                <a href={mapHref(event.address)} target="_blank" rel="noreferrer" className="crm-btn crm-btn-ghost">
                  Directions
                </a>
              )}
            </div>

            <dl className="cal-panel-dl">
              <div>
                <dt>Stage</dt>
                <dd>{STATUS_LABELS[event.status as Status] ?? event.status}</dd>
              </div>
              {event.service && (
                <div>
                  <dt>Service</dt>
                  <dd>{event.service}</dd>
                </div>
              )}
              {event.address && (
                <div>
                  <dt>Address</dt>
                  <dd>{event.address}</dd>
                </div>
              )}
            </dl>

            <div className="cal-panel-actions">
              <button type="button" className="crm-btn crm-btn-primary" onClick={onOpen}>
                Open job
              </button>
              <button type="button" className="crm-btn crm-btn-ghost" onClick={() => setMode("move")} disabled={busy}>
                Reschedule
              </button>
              <button type="button" className="crm-btn cal-btn-danger" onClick={() => setMode("delete")} disabled={busy}>
                Delete
              </button>
            </div>
          </>
        )}

        {mode === "move" && (
          <form
            className="cal-panel-form"
            action={(fd) => {
              fd.set("id", event.id);
              fd.set("kind", serverKind(event.kind));
              moveAction(fd);
            }}
          >
            <label className="crm-field">
              <span>Date</span>
              <input
                type="date"
                name="date"
                className="crm-input"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </label>
            <label className="crm-field">
              <span>Time</span>
              <select name="time" className="crm-input" value={time} onChange={(e) => setTime(e.target.value)}>
                {times.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <p className="crm-muted crm-sm">
              {isJob
                ? "The customer gets a text that their project moved, and the crew and calendar are updated."
                : "The customer gets a text that their quote visit moved."}
            </p>
            <div className="cal-panel-actions">
              <button type="submit" className="crm-btn crm-btn-primary" disabled={busy}>
                {busy ? "Saving…" : "Save new time"}
              </button>
              <button type="button" className="crm-btn crm-btn-ghost" onClick={() => setMode("view")} disabled={busy}>
                Cancel
              </button>
            </div>
          </form>
        )}

        {mode === "delete" && (
          <form
            className="cal-panel-form"
            action={(fd) => {
              fd.set("id", event.id);
              fd.set("kind", serverKind(event.kind));
              fd.set("notify", notify ? "yes" : "no");
              delAction(fd);
            }}
          >
            <p className="cal-panel-warn">
              {isJob
                ? `This releases ${event.title}'s work day. The job goes back to Needs scheduling and stays in your pipeline.`
                : `This removes ${event.title}'s quote visit. The lead stays in your pipeline.`}
            </p>
            <label className="cal-panel-check">
              <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
              <span>
                Text {event.title.split(" ")[0]} that it was cancelled
                <em>Leave this on unless you have already spoken to them.</em>
              </span>
            </label>
            <div className="cal-panel-actions">
              <button type="submit" className="crm-btn cal-btn-danger" disabled={busy}>
                {busy ? "Removing…" : isJob ? "Release the date" : "Remove the visit"}
              </button>
              <button type="button" className="crm-btn crm-btn-ghost" onClick={() => setMode("view")} disabled={busy}>
                Keep it
              </button>
            </div>
          </form>
        )}

        {error && <p className="crm-auth-error">{error}</p>}
        <a className="cal-panel-link" href={`${base}/quotes/${event.id}`}>
          View the full job
        </a>
      </aside>
    </div>
  );
}
