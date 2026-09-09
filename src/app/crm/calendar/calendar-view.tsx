"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { todayYmd } from "@/lib/crm/clock";
import { UNASSIGNED_COLOR, crewColors, initials, shortName } from "@/lib/crm/crew-colors";
import { DEFAULT_VISIT_SLOTS, to12Hour, to24Hour } from "@/lib/crm/constants";
import { dict, fill, type Dict, type Locale } from "@/lib/crm/i18n";
import { deleteEvent, moveEvent, type CalActionState } from "./actions";

// Two things somebody has to show up for, and one nobody has agreed to yet:
//
//   job        a booked work day
//   inperson   a quote visit with a drive attached
//   online     a slot an online customer offered in case photos aren't enough
//
// The third is not an appointment and is never drawn like one - it is faded,
// labelled "Not booked", and can't be dragged. It is here because it is the
// only date on this page that still needs answering, and leaving it off meant
// the office found it by opening leads one at a time.
export type CalKind = "job" | "inperson" | "online";

// Nobody has agreed to this one. Drives the faded styling, the "Not booked"
// label, and the absence of the drag/reschedule/cancel affordances.
const isRequested = (k: CalKind) => k === "online";

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
  // Whose appointment this is. Null is a real state and a loud one: a dated job
  // nobody owns is the thing on this page most likely to go wrong.
  assignedTo: string | null;
  assignedName: string | null;
};

// The roster, so a colour can be looked up and the legend can list people who
// have nothing booked this month.
export type CrewMember = { id: string; name: string };

/**
 * Whose job this is, in the space of a full stop.
 *
 * Initials plus a colour, never a colour alone: the calendar's own colours
 * already mean "work day" and "quote visit", so a bare dot here would be a
 * fourth thing to decode. The ring is what keeps it legible sitting on top of
 * a green or amber chip.
 */
function CrewBadge({
  name,
  color,
  size = "sm",
  title,
}: {
  name: string | null;
  color: string;
  size?: "sm" | "md";
  title?: string;
}) {
  return (
    <span
      className={`crew-badge crew-badge-${size}${name ? "" : " crew-badge-none"}`}
      style={{ background: color }}
      title={title ?? (name ?? "Unassigned")}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

const kindLabel = (t: Dict, k: CalKind) =>
  k === "job" ? t.calendar.kindJob : k === "online" ? t.calendar.kindOnline : t.calendar.kindInPerson;

// Month names and weekday initials come from the browser rather than a hand
// written list, so Spanish gets "enero" and "L M X J V S D" without a second
// table to keep in sync.
const intlLocale = (l: Locale) => (l === "es" ? "es-US" : "en-US");

function monthNames(locale: Locale): string[] {
  const f = new Intl.DateTimeFormat(intlLocale(locale), { month: "long", timeZone: "UTC" });
  return Array.from({ length: 12 }, (_, m) => {
    const name = f.format(new Date(Date.UTC(2024, m, 1)));
    return name.charAt(0).toUpperCase() + name.slice(1);
  });
}

// [full, initial] per weekday, starting Sunday. CSS picks which one shows: a
// single letter is all that fits over a 45px column.
function weekdayNames(locale: Locale): [string, string][] {
  const long = new Intl.DateTimeFormat(intlLocale(locale), { weekday: "short", timeZone: "UTC" });
  const narrow = new Intl.DateTimeFormat(intlLocale(locale), { weekday: "narrow", timeZone: "UTC" });
  return Array.from({ length: 7 }, (_, i) => {
    // 2024-09-01 was a Sunday. Read in UTC, so the header can never come back
    // shifted by one against a grid that starts its rows on Sunday.
    const d = new Date(Date.UTC(2024, 8, 1 + i));
    const full = long.format(d);
    return [full.charAt(0).toUpperCase() + full.slice(1), narrow.format(d).toUpperCase()];
  });
}

// How many chips fit in a month cell before it collapses into "+N more".
const MAX_CHIPS = 3;
const VIEW_KEY = "rcg-cal-view";

// UTC getters throughout this file, deliberately, and it has nothing to do with
// UTC being a timezone anybody here lives in.
//
// A month grid is pure calendar arithmetic: which numbers go in which columns is
// the same question in every timezone on earth. Doing that arithmetic with local
// Date parts means asking the browser's clock a question that is not about the
// browser's clock, and it drags in every place local midnight can shift, go
// missing, or land on a different date than the one the CRM is working in - the
// grid was being laid out in the viewer's zone while "today" came from Raleigh.
// Pinning the arithmetic to UTC removes the clock from it entirely: the same
// dates land in the same columns for everyone, forever.
function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function longDate(s: string, locale: Locale): string {
  return new Date(`${s}T00:00:00Z`).toLocaleDateString(intlLocale(locale), {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

// "Today", "Tomorrow", "Yesterday", then the date. On a job site the only
// questions are "is this now" and "is this next", so those get words.
function dayHeading(date: string, todayStr: string, t: Dict, locale: Locale): { main: string; sub: string } {
  const diff = daysBetween(todayStr, date);
  const d = new Date(`${date}T00:00:00Z`);
  const sameYear = d.getUTCFullYear() === new Date(`${todayStr}T00:00:00Z`).getUTCFullYear();
  const raw = d.toLocaleDateString(intlLocale(locale), {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
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

export function CalendarView({
  events,
  crew,
  base,
  locale,
}: {
  events: CalEvent[];
  crew: CrewMember[];
  base: string;
  locale: Locale;
}) {
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
  const [show, setShow] = useState<Record<CalKind, boolean>>({ job: true, inperson: true, online: true });
  // Null means everybody. Clicking a name in the legend narrows the whole
  // calendar to one person's week, which is the question straight after "whose
  // is that?" - and clicking them again puts everyone back.
  const [who, setWho] = useState<string | null>(null);

  // One colour per person, derived from their staff id, so it is the same on
  // every device without storing anything. Anyone on the calendar but off the
  // roster (a deleted account) still gets a slot rather than no colour at all.
  const colors = useMemo(
    () => crewColors([...crew.map((c) => c.id), ...events.map((e) => e.assignedTo ?? "").filter(Boolean)]),
    [crew, events],
  );
  const colorOf = (id: string | null) => (id ? (colors.get(id) ?? UNASSIGNED_COLOR) : UNASSIGNED_COLOR);

  // The legend: the roster, plus an Unassigned entry only when something on
  // this calendar actually has nobody on it. A permanent "Unassigned" filter
  // for a state you never reach is a button that always comes back empty.
  const legend = useMemo(() => {
    const rows = crew.map((c) => ({ id: c.id, name: c.name, color: colorOf(c.id) }));
    if (events.some((e) => !e.assignedTo)) {
      rows.push({ id: "", name: t.calendar.unassigned, color: UNASSIGNED_COLOR });
    }
    return rows;
  }, [crew, events, colors, t]);

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

  const visible = useMemo(
    () => events.filter((e) => show[e.kind] && (who === null || (e.assignedTo ?? "") === who)),
    [events, show, who],
  );

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

  // Six weeks from the Sunday on or before the 1st. Built by adding whole days
  // to a UTC instant, which is the one kind of date arithmetic that cannot be
  // knocked sideways by a clock going forward, back, or missing an hour.
  const cells = useMemo(() => {
    const first = Date.UTC(cursor.y, cursor.m, 1);
    const start = first - new Date(first).getUTCDay() * 86_400_000;
    return Array.from({ length: 42 }, (_, i) => new Date(start + i * 86_400_000));
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
        {(["job", "inperson", "online"] as CalKind[]).map((k) => (
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

      {/* Who is on the calendar. It is a legend first - a colour means nothing
          until it has a name beside it - and a filter second, because "just
          show me Ana's week" is the question straight after "whose is that?".
          Hidden with one contractor: a legend of one explains nothing, and a
          filter that can only ever say "everyone" or "the only person" is a
          control that does nothing twice. */}
      {legend.length > 1 && (
        <div className="cal-crew" role="group" aria-label={t.calendar.crewLegend}>
          <button
            type="button"
            className={`cal-crew-chip${who === null ? " cal-crew-on" : ""}`}
            onClick={() => setWho(null)}
            aria-pressed={who === null}
          >
            {t.calendar.everyone}
          </button>
          {legend.map((c) => (
            <button
              key={c.id || "unassigned"}
              type="button"
              className={`cal-crew-chip${who === c.id ? " cal-crew-on" : ""}`}
              onClick={() => setWho((w) => (w === c.id ? null : c.id))}
              aria-pressed={who === c.id}
              style={who === c.id ? { borderColor: c.color } : undefined}
            >
              <CrewBadge name={c.id ? c.name : null} color={c.color} />
              {shortName(c.name) || c.name}
            </button>
          ))}
        </div>
      )}

      {view === "list" ? (
        <div className={`cal-agenda${busy ? " cal-busy" : ""}`}>
          {upcoming.length === 0 && earlier.length === 0 && <p className="cal-empty">{t.calendar.empty}</p>}

          {upcoming.map((g) => (
            <DayGroup key={g.date} group={g} todayStr={todayStr} t={t} locale={locale} colorOf={colorOf} onPick={setSelected} />
          ))}

          {earlier.length > 0 && (
            <>
              <h4 className="cal-section">
                {t.calendar.earlier}
                <span>{earlier.reduce((n, g) => n + g.items.length, 0)}</span>
              </h4>
              {earlier.map((g) => (
                <DayGroup key={g.date} group={g} todayStr={todayStr} t={t} locale={locale} past colorOf={colorOf} onPick={setSelected} />
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
              const inMonth = d.getUTCMonth() === cursor.m;
              const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
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
                  <span className="cal-daynum">{d.getUTCDate()}</span>

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
                        // A requested slot has nothing to move: it is the
                        // customer's suggestion, not a date we hold. Dragging
                        // it would text them that a visit they were never
                        // promised had been rescheduled.
                        draggable={!busy && !isRequested(e.kind)}
                        onDragStart={(ev) => {
                          ev.dataTransfer.setData("text/plain", e.id);
                          ev.dataTransfer.effectAllowed = "move";
                          setDragId(e.id);
                        }}
                        onDragEnd={() => setDragId(null)}
                        onClick={() => setSelected(e)}
                        title={`${kindLabel(t, e.kind)}: ${e.title}${e.time ? ` · ${e.time}` : ""} · ${
                          e.assignedName ?? t.calendar.unassigned
                        }${isRequested(e.kind) ? ` · ${t.calendar.notBooked}` : ""}`}
                      >
                        {e.time && <span className="cal-chip-time">{e.time}</span>}
                        {/* The badge rides on the name line rather than its own:
                            a chip is two lines tall and a third would push the
                            day cell past what a month grid has room for. */}
                        <span className="cal-chip-title">
                          <CrewBadge name={e.assignedName} color={colorOf(e.assignedTo)} />
                          {e.title}
                        </span>
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
                      <span className="cal-row-kind">
                        {kindLabel(t, e.kind)}
                        {isRequested(e.kind) && <em className="cal-tentative">{t.calendar.notBooked}</em>}
                      </span>
                      {/* Spelled out here, not just badged. A list row has the width for
                          a name, and reading one beats decoding two letters. */}
                      <span className="cal-row-crew">
                        <CrewBadge name={e.assignedName} color={colorOf(e.assignedTo)} />
                        <span className={e.assignedName ? "" : "cal-row-none"}>{e.assignedName ?? t.calendar.unassigned}</span>
                      </span>
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
          crewColor={colorOf(selected.assignedTo)}
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
  colorOf,
  onPick,
}: {
  group: { date: string; items: CalEvent[] };
  todayStr: string;
  t: Dict;
  locale: Locale;
  past?: boolean;
  colorOf: (id: string | null) => string;
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
              <span className="cal-row-kind">
                {kindLabel(t, e.kind)}
                {isRequested(e.kind) && <em className="cal-tentative">{t.calendar.notBooked}</em>}
              </span>
              {/* Spelled out here, not just badged. A list row has the width for
                  a name, and reading one beats decoding two letters. */}
              <span className="cal-row-crew">
                <CrewBadge name={e.assignedName} color={colorOf(e.assignedTo)} />
                <span className={e.assignedName ? "" : "cal-row-none"}>{e.assignedName ?? t.calendar.unassigned}</span>
              </span>
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
  crewColor,
  error,
  onClose,
  onOpen,
  moveAction,
  delAction,
}: {
  event: CalEvent;
  base: string;
  busy: boolean;
  crewColor: string;
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
                <dt>{t.calendar.crewLegend}</dt>
                <dd className="cal-panel-crew">
                  <CrewBadge name={event.assignedName} color={crewColor} size="md" />
                  <span className={event.assignedName ? "" : "cal-row-none"}>
                    {event.assignedName ?? t.calendar.unassigned}
                  </span>
                </dd>
              </div>
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

            {/* Reschedule and Cancel are for dates we hold. A requested slot
                is the customer's suggestion, and both buttons would text them
                about an appointment nobody ever made - so the only way on is
                Open job, where confirming it is a real decision with a real
                text attached. */}
            {isRequested(event.kind) && (
              <p className="cal-panel-note">{fill(t.calendar.requestedNote, { name: event.title })}</p>
            )}

            <div className="cal-panel-actions">
              <button type="button" className="crm-btn crm-btn-primary" onClick={onOpen}>
                {t.calendar.openJob}
              </button>
              {!isRequested(event.kind) && (
                <>
                  <button type="button" className="crm-btn crm-btn-ghost" onClick={() => setMode("move")} disabled={busy}>
                    {t.calendar.reschedule}
                  </button>
                  <button
                    type="button"
                    className="crm-btn cal-btn-danger"
                    onClick={() => setMode("delete")}
                    disabled={busy}
                  >
                    {t.calendar.remove}
                  </button>
                </>
              )}
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
