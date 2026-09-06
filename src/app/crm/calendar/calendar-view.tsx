"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { todayYmd } from "@/lib/crm/clock";
import { DEFAULT_VISIT_SLOTS, to12Hour, to24Hour } from "@/lib/crm/constants";
import { dict, fill, type Dict, type Locale } from "@/lib/crm/i18n";
import { deleteEvent, moveEvent, type CalActionState } from "./actions";

// Only things somebody has to show up for. An online quote is desk work with no
// place to be, so it never becomes a calendar event and there is no filter for
// one - a chip that can never match anything is just another thing to read.
export type CalKind = "job" | "inperson";

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

const kindLabel = (t: Dict, k: CalKind) => (k === "job" ? t.calendar.kindJob : t.calendar.kindInPerson);

// Month names and weekday initials come from the browser rather than a hand
// written list, so Spanish gets "enero" and "L M X J V S D" without a second
// table to keep in sync.
const intlLocale = (l: Locale) => (l === "es" ? "es-US" : "en-US");

function monthNames(locale: Locale): string[] {
  const f = new Intl.DateTimeFormat(intlLocale(locale), { month: "long" });
  return Array.from({ length: 12 }, (_, m) => {
    const name = f.format(new Date(2024, m, 1));
    return name.charAt(0).toUpperCase() + name.slice(1);
  });
}

// [full, initial] per weekday, starting Sunday. CSS picks which one shows: a
// single letter is all that fits over a 45px column.
function weekdayNames(locale: Locale): [string, string][] {
  const long = new Intl.DateTimeFormat(intlLocale(locale), { weekday: "short" });
  const narrow = new Intl.DateTimeFormat(intlLocale(locale), { weekday: "narrow" });
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(2024, 8, 1 + i); // 2024-09-01 was a Sunday
    const full = long.format(d);
    return [full.charAt(0).toUpperCase() + full.slice(1), narrow.format(d).toUpperCase()];
  });
}

// How many chips fit in a month cell before it collapses into "+N more".
const MAX_CHIPS = 3;
const VIEW_KEY = "rcg-cal-view";

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function longDate(s: string, locale: Locale): string {
  return new Date(`${s}T00:00:00`).toLocaleDateString(intlLocale(locale), {
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

// "Today", "Tomorrow", "Yesterday", then the date. On a job site the only
// questions are "is this now" and "is this next", so those get words.
function dayHeading(date: string, todayStr: string, t: Dict, locale: Locale): { main: string; sub: string } {
  const diff = daysBetween(todayStr, date);
  const d = new Date(`${date}T00:00:00`);
  const sameYear = d.getFullYear() === new Date(`${todayStr}T00:00:00`).getFullYear();
  const raw = d.toLocaleDateString(intlLocale(locale), {
    weekday: "long",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  const full = raw.charAt(0).toUpperCase() + raw.slice(1);
  if (diff === 0) return { main: t.calendar.today, sub: full };
  if (diff === 1) return { main: t.calendar.tomorrow, sub: full };
  if (diff === -1) return { main: t.calendar.yesterday, sub: full };
  if (diff > 1 && diff < 7) return { main: full, sub: fill(t.calendar.inDays, { n: diff }) };
  if (diff < -1 && diff > -7) return { main: full, sub: fill(t.calendar.daysAgo, { n: -diff }) };
  return { main: full, sub: "" };
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

export function CalendarView({ events, base, locale }: { events: CalEvent[]; base: string; locale: Locale }) {
  const router = useRouter();
  const t = dict(locale);
  const MONTHS = useMemo(() => monthNames(locale), [locale]);
  const DOW = useMemo(() => weekdayNames(locale), [locale]);
  // Raleigh's today, not the viewer's. A phone that has wandered into another
  // zone - or is simply set wrong - would otherwise ring the wrong cell and
  // file jobs under the wrong day.
  const todayStr = todayYmd();
  const [todayY, todayM] = todayStr.split("-").map(Number);

  // List is the default: this is used in the field far more than at a desk, and
  // a 7-column grid on a phone gives you 45px cells nobody can read or tap. A
  // wide screen flips to Month on first load, then whatever you last chose.
  const [view, setView] = useState<"list" | "month">("list");
  const [cursor, setCursor] = useState({ y: todayY, m: todayM - 1 });
  const [show, setShow] = useState<Record<CalKind, boolean>>({ job: true, inperson: true });

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

  // Everything shows, nothing is hidden. What's coming leads, because that's
  // what you open this for, and finished work follows under its own heading,
  // newest first. An earlier version cut off anything before today, which meant
  // a customer whose only visit had already happened looked like no customer
  // at all.
  const upcoming = useMemo(
    () =>
      [...byDate.keys()]
        .filter((d) => d >= todayStr)
        .sort()
        .map((d) => ({ date: d, items: byDate.get(d) ?? [] })),
    [byDate, todayStr],
  );

  const earlier = useMemo(
    () =>
      [...byDate.keys()]
        .filter((d) => d < todayStr)
        .sort()
        .reverse()
        .map((d) => ({ date: d, items: byDate.get(d) ?? [] })),
    [byDate, todayStr],
  );

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
        <div className="cal-views" role="group" aria-label={t.calendar.viewLabel}>
          <button
            type="button"
            aria-pressed={view === "list"}
            className={`cal-view${view === "list" ? " cal-view-on" : ""}`}
            onClick={() => pickView("list")}
          >
            {t.calendar.viewSchedule}
          </button>
          <button
            type="button"
            aria-pressed={view === "month"}
            className={`cal-view${view === "month" ? " cal-view-on" : ""}`}
            onClick={() => pickView("month")}
          >
            {t.calendar.viewMonth}
          </button>
        </div>

        {view === "month" && (
          <div className="cal-month-nav">
            <button type="button" className="cal-nav" onClick={() => shift(-1)} aria-label={t.calendar.prevMonth}>
              ‹
            </button>
            <strong className="cal-month-name">
              {MONTHS[cursor.m]} {cursor.y}
            </strong>
            <button type="button" className="cal-nav" onClick={() => shift(1)} aria-label={t.calendar.nextMonth}>
              ›
            </button>
            <button
              type="button"
              className="cal-nav cal-nav-today"
              onClick={() => setCursor({ y: todayY, m: todayM - 1 })}
            >
              {t.calendar.today}
            </button>
          </div>
        )}
      </div>

      <div className="cal-filters">
        {(["job", "inperson"] as CalKind[]).map((k) => (
          <button
            key={k}
            type="button"
            className={`cal-filter cal-filter-${k}${show[k] ? " cal-filter-on" : ""}`}
            onClick={() => setShow((s) => ({ ...s, [k]: !s[k] }))}
            aria-pressed={show[k]}
          >
            {kindLabel(t, k)}
          </button>
        ))}
      </div>

      {view === "list" ? (
        <div className={`cal-agenda${busy ? " cal-busy" : ""}`}>
          {upcoming.length === 0 && earlier.length === 0 && <p className="cal-empty">{t.calendar.empty}</p>}

          {upcoming.map((g) => (
            <DayGroup key={g.date} group={g} todayStr={todayStr} t={t} locale={locale} onPick={setSelected} />
          ))}

          {earlier.length > 0 && (
            <>
              <h4 className="cal-section">
                {t.calendar.earlier}
                <span>{earlier.reduce((n, g) => n + g.items.length, 0)}</span>
              </h4>
              {earlier.map((g) => (
                <DayGroup key={g.date} group={g} todayStr={todayStr} t={t} locale={locale} past onPick={setSelected} />
              ))}
            </>
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
                        title={`${kindLabel(t, e.kind)}: ${e.title}${e.time ? ` · ${e.time}` : ""}`}
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
                      aria-label={`${dayEvents.length} · ${longDate(key, locale)}`}
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

          <p className="cal-help crm-muted crm-sm">{t.calendar.dragHint}</p>
        </>
      )}

      {openDay && (
        <div className="cal-scrim" onClick={() => setOpenDay(null)} role="presentation">
          <div className="cal-daypanel" onClick={(e) => e.stopPropagation()}>
            <div className="cal-panel-head">
              <h3>{longDate(openDay, locale)}</h3>
              <button type="button" className="cal-panel-x" onClick={() => setOpenDay(null)} aria-label={t.common.close}>
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
                    <span className="cal-row-time">{e.time ?? t.calendar.allDay}</span>
                    <span className="cal-row-body">
                      <span className="cal-row-name">{e.title}</span>
                      <span className="cal-row-kind">{kindLabel(t, e.kind)}</span>
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
          t={t}
          locale={locale}
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

/* One day in the schedule list. Rows are full-width tap targets with Call and
   Map on the row itself, since those are what actually get used from a truck. */
function DayGroup({
  group,
  todayStr,
  t,
  locale,
  past = false,
  onPick,
}: {
  group: { date: string; items: CalEvent[] };
  todayStr: string;
  t: Dict;
  locale: Locale;
  past?: boolean;
  onPick: (e: CalEvent) => void;
}) {
  const h = dayHeading(group.date, todayStr, t, locale);
  return (
    <section className={`cal-day${past ? " cal-day-past" : ""}`}>
      <h3 className={`cal-day-head${group.date === todayStr ? " cal-day-today" : ""}`}>
        <span className="cal-day-main">{h.main}</span>
        {h.sub && <span className="cal-day-sub">{h.sub}</span>}
      </h3>

      {group.items.map((e) => (
        <article key={e.id + e.kind} className={`cal-row cal-row-${e.kind}`}>
          <button type="button" className="cal-row-main" onClick={() => onPick(e)}>
            <span className="cal-row-time">{e.time ?? t.calendar.allDay}</span>
            <span className="cal-row-body">
              <span className="cal-row-name">{e.title}</span>
              <span className="cal-row-kind">{kindLabel(t, e.kind)}</span>
              {e.address && <span className="cal-row-addr">{e.address}</span>}
            </span>
          </button>
          <div className="cal-row-acts">
            <a href={telHref(e.phone)} className="cal-act" aria-label={`${t.calendar.call} ${e.title}`}>
              {t.calendar.call}
            </a>
            {e.address && (
              <a href={mapHref(e.address)} target="_blank" rel="noreferrer" className="cal-act">
                {t.calendar.map}
              </a>
            )}
          </div>
        </article>
      ))}
    </section>
  );
}

/* ── The detail panel: what this appointment is, and the three things you can
      do to it. States what the customer will be told before anything
      irreversible happens. ──────────────────────────────────────────────── */
function EventPanel({
  event,
  base,
  busy,
  t,
  locale,
  error,
  onClose,
  onOpen,
  moveAction,
  delAction,
}: {
  event: CalEvent;
  base: string;
  busy: boolean;
  t: Dict;
  locale: Locale;
  error?: string;
  onClose: () => void;
  onOpen: () => void;
  moveAction: (fd: FormData) => void;
  delAction: (fd: FormData) => void;
}) {
  const isJob = event.kind === "job";

  const [mode, setMode] = useState<"view" | "move" | "delete">("view");
  const [date, setDate] = useState(event.date);
  // Only what the field opens on when the appointment has no time yet. The
  // office isn't held to either list - see the picker below.
  const [time, setTime] = useState(event.time ?? (isJob ? "9:00 AM" : DEFAULT_VISIT_SLOTS[0]));
  const [notify, setNotify] = useState(true);

  return (
    <div className="cal-scrim" onClick={onClose} role="presentation">
      <aside className="cal-panel" onClick={(e) => e.stopPropagation()} aria-label={t.calendar.appointment}>
        <div className="cal-panel-head">
          <div>
            <span className={`cal-panel-kind cal-bg-${event.kind}`}>{kindLabel(t, event.kind)}</span>
            <h3>{event.title}</h3>
          </div>
          <button type="button" className="cal-panel-x" onClick={onClose} aria-label={t.common.close}>
            ×
          </button>
        </div>

        <p className="cal-panel-when">
          {longDate(event.date, locale)}
          {event.time ? ` · ${event.time}` : ""}
        </p>

        {mode === "view" && (
          <>
            <div className="cal-panel-quick">
              <a href={telHref(event.phone)} className="crm-btn crm-btn-ghost">
                {t.calendar.call} {event.phone}
              </a>
              {event.address && (
                <a href={mapHref(event.address)} target="_blank" rel="noreferrer" className="crm-btn crm-btn-ghost">
                  {t.calendar.directions}
                </a>
              )}
            </div>

            <dl className="cal-panel-dl">
              <div>
                <dt>{t.calendar.stage}</dt>
                <dd>{t.status[event.status as keyof typeof t.status] ?? event.status}</dd>
              </div>
              {event.service && (
                <div>
                  <dt>{t.calendar.service}</dt>
                  <dd>{event.service}</dd>
                </div>
              )}
              {event.address && (
                <div>
                  <dt>{t.calendar.address}</dt>
                  <dd>{event.address}</dd>
                </div>
              )}
            </dl>

            <div className="cal-panel-actions">
              <button type="button" className="crm-btn crm-btn-primary" onClick={onOpen}>
                {t.calendar.openJob}
              </button>
              <button type="button" className="crm-btn crm-btn-ghost" onClick={() => setMode("move")} disabled={busy}>
                {t.calendar.reschedule}
              </button>
              <button type="button" className="crm-btn cal-btn-danger" onClick={() => setMode("delete")} disabled={busy}>
                {t.calendar.remove}
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
              <span>{t.calendar.date}</span>
              <input
                type="date"
                name="date"
                className="crm-input"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </label>
            {/* Any time of day, not a fixed list. The five slots on the public
                form are what a customer may request; rescheduling from here is
                the office moving a real appointment around a real day, and
                both moveEvent paths already validate the time by shape
                (TIME_RE) rather than against any list. */}
            <label className="crm-field">
              <span>{t.calendar.time}</span>
              <input
                type="time"
                className="crm-input"
                value={to24Hour(time, isJob ? "09:00" : "08:00")}
                onChange={(e) => e.target.value && setTime(to12Hour(e.target.value))}
              />
              {/* moveEvent reads FormData, not component state, so the picked
                  time still needs the field name the old select carried. */}
              <input type="hidden" name="time" value={time} />
            </label>
            <p className="crm-muted crm-sm">{isJob ? t.calendar.moveNoteJob : t.calendar.moveNoteVisit}</p>
            <div className="cal-panel-actions">
              <button type="submit" className="crm-btn crm-btn-primary" disabled={busy}>
                {busy ? t.calendar.saving : t.calendar.saveNewTime}
              </button>
              <button type="button" className="crm-btn crm-btn-ghost" onClick={() => setMode("view")} disabled={busy}>
                {t.common.cancel}
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
              {fill(isJob ? t.calendar.warnJob : t.calendar.warnVisit, { name: event.title })}
            </p>
            <label className="cal-panel-check">
              <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
              <span>
                {fill(t.calendar.notifyLabel, { name: event.title.split(" ")[0] })}
                <em>{t.calendar.notifyHint}</em>
              </span>
            </label>
            <div className="cal-panel-actions">
              <button type="submit" className="crm-btn cal-btn-danger" disabled={busy}>
                {busy ? t.calendar.removing : isJob ? t.calendar.releaseDate : t.calendar.removeVisit}
              </button>
              <button type="button" className="crm-btn crm-btn-ghost" onClick={() => setMode("view")} disabled={busy}>
                {t.calendar.keepIt}
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
