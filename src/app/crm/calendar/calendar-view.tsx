"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export type CalEvent = {
  id: string;
  date: string; // yyyy-mm-dd
  kind: "job" | "visit";
  title: string;
  time: string | null;
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

  const byDate = useMemo(() => {
    const map = new Map<string, CalEvent[]>();
    for (const e of events) {
      const list = map.get(e.date) ?? [];
      list.push(e);
      map.set(e.date, list);
    }
    return map;
  }, [events]);

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
                    title={`${e.kind === "job" ? "Booked job" : "In-person quote"}: ${e.title}${e.time ? ` · ${e.time}` : ""}`}
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
        <span className="cal-legend-item">
          <i className="cal-dot cal-dot-job" /> Booked job
        </span>
        <span className="cal-legend-item">
          <i className="cal-dot cal-dot-visit" /> In-person quote
        </span>
      </div>
    </div>
  );
}
