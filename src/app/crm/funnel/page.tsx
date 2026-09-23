import Link from "next/link";

import { CLARITY_PROJECT_ID } from "@/lib/clarity-id";
import { requireOwner } from "@/lib/crm/auth";
import { crmBase } from "@/lib/crm/nav";
import { pgAdmin } from "@/lib/crm/rest";
import { formatMs, funnelStats, type Count, type FunnelRow, type SplitRow } from "@/lib/funnel-stats";

export const dynamic = "force-dynamic";

// The quote funnel: of the people who opened Get Free Quote, how many got to
// each step, how long each step took them, and where and why the rest gave up.
// Recorded by the form itself (src/lib/funnel.ts) into site_funnel_events.
//
// Clicks and scrolling on the rest of the site are Microsoft Clarity's job
// (src/components/clarity.tsx) - this page is only the form.

const WINDOWS = [7, 30, 90] as const;
// PostgREST hands back at most 1000 rows a request. 50 pages is 50,000 events,
// far past anything this site sees in 90 days; past that the page says so.
const PAGE = 1000;
const MAX_PAGES = 50;

const STEP_LABELS: Record<string, string> = {
  choice: "Online or in-person",
  contact: "Contact + address",
  service: "Service + photos",
  schedule: "Date + time",
};

// What each recorded code means, in the office's words.
const DETAIL_LABELS: Record<string, string> = {
  ready: "everything filled in",
  left_page: "closed the tab / left",
  name: "name",
  phone: "phone",
  address: "address",
  email: "email",
  consent: "consent box",
  service: "no service picked",
  date: "no date",
  time: "no time",
  day_full: "day fully booked",
  day_off: "day not worked",
  file_type: "file wasn't a photo/video",
  file_size: "file too big",
  upload: "photo upload failed",
  network: "network error",
  server_409: "slot taken while they chose",
  server_429: "rate limited",
  server_500: "server error",
  server_502: "database save failed",
  server_503: "server not configured to save",
  server_demo: "server not configured to save",
  honeypot: "caught by the spam trap (not saved)",
};

function detailLabel(detail: string): string {
  if (DETAIL_LABELS[detail]) return DETAIL_LABELS[detail];
  if (detail.startsWith("server_")) return `rejected: ${detail.slice(7).replace(/\+/g, ", ").replace(/_/g, " ")}`;
  // "phone+address" -> "missing phone, address"
  if (detail.includes("+") || ["name", "phone", "address", "email"].includes(detail)) {
    return `missing ${detail.split("+").map((d) => DETAIL_LABELS[d] ?? d).join(", ")}`;
  }
  return detail.replace(/_/g, " ");
}

// Keys come out of funnel-stats as "step · detail".
function reasonLabel(key: string): string {
  const [step, detail] = key.split(" · ");
  const where = STEP_LABELS[step] ?? step;
  return detail ? `${where} - ${detailLabel(detail)}` : where;
}

function pct(part: number, whole: number): string {
  return whole ? `${Math.round((part / whole) * 100)}%` : "-";
}

async function loadRows(days: number): Promise<{ rows: FunnelRow[]; missingTable: boolean; truncated: boolean }> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const rows: FunnelRow[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await pgAdmin(
      `site_funnel_events?select=attempt_id,visitor_id,form,event,step,ms,mode,detail,path,device` +
        `&created_at=gte.${encodeURIComponent(since)}&order=id.asc&limit=${PAGE}&offset=${page * PAGE}`,
    );
    // 404 / 42P01: supabase/funnel.sql hasn't been run yet.
    if (!res.ok) return { rows, missingTable: page === 0, truncated: false };
    const batch = (await res.json()) as FunnelRow[];
    rows.push(...batch);
    if (batch.length < PAGE) return { rows, missingTable: false, truncated: false };
  }
  return { rows, missingTable: false, truncated: true };
}

function CountTable({ title, empty, rows, label }: { title: string; empty: string; rows: Count[]; label: (k: string) => string }) {
  return (
    <section className="crm-card">
      <h2 className="crm-card-title">{title}</h2>
      {rows.length === 0 ? (
        <p className="crm-muted">{empty}</p>
      ) : (
        <table className="crm-table">
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>{label(r.key)}</td>
                <td className="fn-num">{r.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function SplitTable({ title, first, rows, label }: { title: string; first: string; rows: SplitRow[]; label?: (k: string) => string }) {
  return (
    <section className="crm-card">
      <h2 className="crm-card-title">{title}</h2>
      {rows.length === 0 ? (
        <p className="crm-muted">Nothing yet.</p>
      ) : (
        <table className="crm-table">
          <thead>
            <tr>
              <th>{first}</th>
              <th className="fn-num">Opened</th>
              <th className="fn-num">Sent</th>
              <th className="fn-num">Rate</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>{label ? label(r.key) : r.key}</td>
                <td className="fn-num">{r.opened}</td>
                <td className="fn-num">{r.submitted}</td>
                <td className="fn-num">{pct(r.submitted, r.opened)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export default async function FunnelPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  await requireOwner();
  const base = await crmBase();
  const sp = await searchParams;
  const days = WINDOWS.find((d) => String(d) === sp.days) ?? 30;

  const { rows, missingTable, truncated } = await loadRows(days);
  const s = funnelStats(rows);
  const clarityOn = Boolean(CLARITY_PROJECT_ID);

  return (
    <main className="crm-page crm-page-wide">
      <div className="crm-page-head">
        <div>
          <h1>Quote funnel</h1>
          <p className="crm-muted">
            Everyone who opened Get Free Quote in the last {days} days: how far they got, how long each step took,
            and where the rest gave up.
          </p>
        </div>
        <nav className="fn-windows" aria-label="Time range">
          {WINDOWS.map((d) => (
            <Link
              key={d}
              href={`${base}/funnel?days=${d}`}
              className={`crm-btn ${d === days ? "crm-btn-primary" : "crm-btn-ghost"}`}
              aria-current={d === days ? "page" : undefined}
            >
              {d} days
            </Link>
          ))}
        </nav>
      </div>

      {missingTable ? (
        <div className="crm-empty">
          Tracking isn&apos;t set up yet. Run <code>supabase/funnel.sql</code> once in Supabase → SQL Editor, and
          visits to the quote form will start showing here.
        </div>
      ) : s.opened === 0 ? (
        <div className="crm-empty">Nobody has opened the quote form in the last {days} days yet.</div>
      ) : (
        <>
          <div className="crm-stats">
            <div className="crm-stat">
              <strong>{s.opened}</strong>
              <span>Opened the form</span>
            </div>
            <div className="crm-stat">
              <strong>{s.visitors}</strong>
              <span>Different people</span>
            </div>
            <div className="crm-stat">
              <strong>{s.submitted}</strong>
              <span>Sent a request</span>
            </div>
            <div className="crm-stat">
              <strong>{pct(s.submitted, s.opened)}</strong>
              <span>Opened → sent</span>
            </div>
            <div className="crm-stat">
              <strong>{formatMs(s.medianSubmitMs)}</strong>
              <span>Typical time to send</span>
            </div>
          </div>

          <section className="crm-card">
            <h2 className="crm-card-title">Step by step</h2>
            <p className="crm-muted fn-note">
              Bars are the share of everyone who opened the form that reached each step. The biggest drop between two
              bars is where the form is losing people.
            </p>
            <div className="crm-table-wrap">
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>Step</th>
                    <th className="fn-bar-col">Reached</th>
                    <th className="fn-num">Gave up here</th>
                    <th className="fn-num">Time to finish</th>
                    <th className="fn-num">Time before giving up</th>
                  </tr>
                </thead>
                <tbody>
                  {s.steps.map((step, i) => {
                    const share = s.opened ? step.reached / s.opened : 0;
                    return (
                      <tr key={step.step}>
                        <td>
                          <strong>{i + 1}.</strong> {STEP_LABELS[step.step]}
                        </td>
                        <td className="fn-bar-col">
                          <div
                            className="fn-bar"
                            title={`${step.reached} of ${s.opened} reached ${STEP_LABELS[step.step]} (${pct(step.reached, s.opened)})`}
                          >
                            <span className="fn-bar-fill" style={{ width: `${Math.max(share * 100, share > 0 ? 1 : 0)}%` }} />
                          </div>
                          <span className="fn-bar-label">
                            {step.reached} <span className="crm-muted">· {pct(step.reached, s.opened)}</span>
                          </span>
                        </td>
                        <td className="fn-num">
                          {step.closedHere}{" "}
                          <span className="crm-muted">({pct(step.closedHere, step.reached)})</span>
                        </td>
                        <td className="fn-num">{formatMs(step.medianMs)}</td>
                        <td className="fn-num">{formatMs(step.medianCloseMs)}</td>
                      </tr>
                    );
                  })}
                  <tr>
                    <td>
                      <strong>✓</strong> Sent
                    </td>
                    <td className="fn-bar-col">
                      <div className="fn-bar" title={`${s.submitted} of ${s.opened} sent a request (${pct(s.submitted, s.opened)})`}>
                        <span className="fn-bar-fill" style={{ width: `${s.opened ? (s.submitted / s.opened) * 100 : 0}%` }} />
                      </div>
                      <span className="fn-bar-label">
                        {s.submitted} <span className="crm-muted">· {pct(s.submitted, s.opened)}</span>
                      </span>
                    </td>
                    <td />
                    <td />
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="crm-muted fn-note">Times are the median - the middle person - so one tab left open overnight doesn&apos;t skew them.</p>
          </section>

          <div className="crm-grid">
            <CountTable
              title="Where they gave up"
              empty="Nobody has closed the form part-way yet."
              rows={s.closeReasons}
              label={reasonLabel}
            />
            <CountTable
              title="Where the form said no"
              empty="No errors, full days or failed uploads."
              rows={s.errors}
              label={reasonLabel}
            />
          </div>

          <div className="crm-grid">
            <SplitTable
              title="Online vs in-person"
              first="Chose"
              rows={s.byMode}
              label={(k) => (k === "online" ? "Online (photos)" : "In-person visit")}
            />
            <SplitTable title="Phone vs computer" first="Device" rows={s.byDevice} label={(k) => (k === "mobile" ? "Phone / tablet" : "Computer")} />
          </div>

          <SplitTable title="Which page they opened it from" first="Page" rows={s.byPath} />


          {truncated && (
            <p className="crm-muted fn-note">Only the first {PAGE * MAX_PAGES} events in this range are counted. Pick a shorter range.</p>
          )}
        </>
      )}

      <section className="crm-card">
        <h2 className="crm-card-title">Clicks, scrolling and recordings</h2>
        <p className="crm-muted">
          {clarityOn
            ? "Heatmaps of where people click and how far they scroll, plus replays of real visits, are in Microsoft Clarity. Filter recordings by the custom event \"quote_close_contact\" (or any other step) to watch people who gave up there."
            : "Not switched on. Create a free project at clarity.microsoft.com, then add its Project ID in Vercel as NEXT_PUBLIC_CLARITY_PROJECT_ID and redeploy."}
        </p>
        {clarityOn && (
          <a className="crm-btn crm-btn-ghost" href={`https://clarity.microsoft.com/projects/view/${CLARITY_PROJECT_ID}/dashboard`} target="_blank" rel="noopener noreferrer">
            Open Clarity
          </a>
        )}
      </section>
    </main>
  );
}
