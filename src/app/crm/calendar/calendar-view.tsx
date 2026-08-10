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
  job: "Job install",
  inperson: "In-person quote",
  online: "Online quote",
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// How many chips fit in a cell before it collapses into "+N more".
const MAX_CHIPS = 3;

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

// A job's date lives in a different column from a visit's, so the server needs
// to know which one it's moving.
const serverKind = (k: CalKind) => (k === "job" ? "job" : "visit");

export function CalendarView({ events, base }: { events: CalEvent[]; base: string }) {
  const router = useRouter();
  const today = new Date();
  const [cursor, setCursor] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const [show, setShow] = useState<Record<CalKind, boolean>>({ job: true, inperson: true, online: true });

  // The appointment open in the side panel, and the day open in the day list.
  const [selected, setSelected] = useState<CalEvent | null>(null);
  const [openDay, setOpenDay] = useState<string | null>(null);

  const [dragId, setDragId] = useState<string | null>(null);
  const [overDay, setOverDay] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Drag-drop and the panel's buttons both dispatch through these, so a result
  // shows up the same way however the change was made.
  const [moveState, moveAction, moving] = useActionState<CalActionState, FormData>(moveEvent, { ok: false });
  const [delState, delAction, deleting] = useActionState<CalActionState, FormData>(deleteEvent, { ok: false });

  const busy = moving || deleting;

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

  // Escape closes whatever is open, like any other dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setSelected(null);
      setOpenDay(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  function toggle(kind: CalKind) {
    setShow((s) => ({ ...s, [kind]: !s[kind] }));
  }

  const byDate = useMemo(() => {
    const map = new Map<string, CalEvent[]>();
    for (const e of events) {
      if (!show[e.kind]) continue;
      const list = map.get(e.date) ?? [];
      list.push(e);
      map.set(e.date, list);
    }
    // Timed appointments first, in clock order, so a day reads top to bottom.
    for (const list of map.values()) {
      list.sort((a, b) => (a.time ?? "zz").localeCompare(b.time ?? "zz", "en", { numeric: true }));
    }
    return map;
  }, [events, show]);

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

  const todayStr = ymd(today);

  function shift(delta: number) {
    setCursor((c) => {
      const m = c.m + delta;
      return { y: c.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 };
    });
  }

  // Dropping a chip on a day keeps its existing time and only moves the date.
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
        <h2>
          {MONTHS[cursor.m]} {cursor.y}
        </h2>
        <div className="cal-bar-btns">
          <button type="button" className="crm-btn crm-btn-ghost" onClick={() => shift(-1)} aria-label="Previous month">
            ‹
          </button>
          <button
            type="button"
            className="crm-btn crm-btn-ghost"
            onClick={() => setCursor({ y: today.getFullYear(), m: today.getMonth() })}
          >
            Today
          </button>
          <button type="button" className="crm-btn crm-btn-ghost" onClick={() => shift(1)} aria-label="Next month">
            ›
          </button>
        </div>
        <div className="cal-legend">
          {(["job", "inperson", "online"] as CalKind[]).map((k) => (
            <button
              key={k}
              type="button"
              className={`cal-legend-item${show[k] ? "" : " cal-legend-off"}`}
              onClick={() => toggle(k)}
              title={show[k] ? `Hide ${KIND_LABEL[k]}` : `Show ${KIND_LABEL[k]}`}
            >
              <i className={`cal-dot cal-dot-${k}`} /> {KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </div>

      <p className="cal-help crm-muted crm-sm">
        Drag an appointment to another day to reschedule it. Click one to see the details, change the time, or remove it.
      </p>

      <div className="cal-grid cal-dow">
        {DOW.map((d) => (
          <div key={d} className="cal-dow-cell">
            {d}
          </div>
        ))}
      </div>

      <div className={`cal-grid${busy ? " cal-grid-busy" : ""}`}>
        {cells.map((d) => {
          const key = ymd(d);
          const inMonth = d.getMonth() === cursor.m;
          const weekend = d.getDay() === 0 || d.getDay() === 6;
          const dayEvents = dayEventsFor(key);
          const visible = dayEvents.slice(0, MAX_CHIPS);
          const hidden = dayEvents.length - visible.length;

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
              <div className="cal-events">
                {visible.map((e) => (
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
            </div>
          );
        })}
      </div>

      {/* All of a day's appointments, for days too full to show inline. */}
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
                <button
                  key={e.id + e.kind}
                  type="button"
                  className={`cal-chip cal-chip-${e.kind}`}
                  onClick={() => {
                    setSelected(e);
                    setOpenDay(null);
                  }}
                >
                  {e.time && <span className="cal-chip-time">{e.time}</span>}
                  <span className="cal-chip-title">{e.title}</span>
                </button>
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
      do to it. Deliberately states what the customer will be told before you
      do anything irreversible. ─────────────────────────────────────────────── */
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
            <span className={`cal-panel-kind cal-dot-${event.kind}`}>{KIND_LABEL[event.kind]}</span>
            <h3>{event.title}</h3>
          </div>
          <button type="button" className="cal-panel-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <dl className="cal-panel-dl">
          <div>
            <dt>When</dt>
            <dd>
              {longDate(event.date)}
              {event.time ? ` at ${event.time}` : ""}
            </dd>
          </div>
          <div>
            <dt>Stage</dt>
            <dd>{STATUS_LABELS[event.status as Status] ?? event.status}</dd>
          </div>
          <div>
            <dt>Phone</dt>
            <dd>
              <a href={`tel:${event.phone.replace(/[^0-9+]/g, "")}`}>{event.phone}</a>
            </dd>
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
              <dd>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.address)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {event.address}
                </a>
              </dd>
            </div>
          )}
        </dl>

        {mode === "view" && (
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
            <p className="crm-muted crm-sm">
              To delete the customer entirely, use Delete on their pipeline card. That can be undone from Archived.
            </p>
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
