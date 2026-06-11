"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export type CalKind = "job" | "inperson" | "online";

export type CalEvent = {
  id: string;
  date: string; // yyyy-mm-dd
  kind: CalKind;
  title: string;
  time: string | null;
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

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function CalendarView({ events, base }: { events: CalEvent[]; base: string }) {
  const router = useRouter();
  const today = new Date();
  const [cursor, setCursor] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const [show, setShow] = useState<Record<CalKind, boolean>>({ job: true, inperson: true, online: true });

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
    return map;
  }, [events, show]);

  // Build the 6-week grid starting on the Sunday on/before the 1st.
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

  return (
    <div className="cal">
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
      </div>

      <div className="cal-grid cal-dow">
        {DOW.map((d) => (
          <div key={d} className="cal-dow-cell">
            {d}
          </div>
        ))}
      </div>

      <div className="cal-grid">
        {cells.map((d) => {
          const key = ymd(d);
          const inMonth = d.getMonth() === cursor.m;
          const dayEvents = byDate.get(key) ?? [];
          return (
            <div key={key} className={`cal-cell${inMonth ? "" : " cal-cell-dim"}${key === todayStr ? " cal-cell-today" : ""}`}>
              <span className="cal-daynum">{d.getDate()}</span>
              <div className="cal-events">
                {dayEvents.map((e) => (
                  <button
                    key={e.id + e.kind}
                    type="button"
                    className={`cal-chip cal-chip-${e.kind}`}
                    onClick={() => router.push(`${base}/quotes/${e.id}`)}
                    title={`${KIND_LABEL[e.kind]}: ${e.title}${e.time ? ` at ${e.time}` : ""}`}
                  >
                    {e.time && <span className="cal-chip-time">{e.time}</span>}
                    <span className="cal-chip-title">{e.title}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
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
  );
}
