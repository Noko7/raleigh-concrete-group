"use client";

import { VISIT_LEAD_DAYS } from "@/lib/crm/constants";
import type { TrackInput } from "@/lib/funnel-client";
import { phoneDisplay, phoneHref } from "@/lib/site-data";
import { IconCheck } from "./icons";
import { prettyDay, StepHead, type FormState, type Mode, type Status } from "./shared";

export function ScheduleStep({
  totalSteps,
  mode,
  minDate,
  data,
  set,
  checkVisitDate,
  dateChecking,
  dateFull,
  dayOff,
  slots,
  takenTimes,
  busy,
  track,
  stepMs,
  submit,
  status,
  errorMsg,
  smsHref,
}: {
  totalSteps: number;
  mode: Mode | null;
  minDate: string;
  data: FormState;
  set: (patch: Partial<FormState>) => void;
  checkVisitDate: (date: string, service: string) => Promise<void>;
  dateChecking: boolean;
  dateFull: boolean;
  dayOff: boolean;
  slots: string[];
  takenTimes: string[];
  busy: boolean;
  track: (input: Omit<TrackInput, "attempt_id" | "form">) => void;
  stepMs: () => number;
  submit: (opts?: { skipVisit?: boolean }) => Promise<void>;
  status: Status;
  errorMsg: string;
  smsHref: string;
}) {
  return (
    <div className="qm-body">
      {/*
        The online wording promises nothing: a customer who thinks they have an appointment when they don't is
        the worst outcome.
      */}
      <StepHead
        n={3}
        of={totalSteps}
        title={mode === "online" ? "If we need a look" : "When should we come?"}
        sub={
          mode === "online"
            ? "Most jobs we price from photos. If yours needs a look, when's good? We'll text before anyone comes out."
            : undefined
        }
      />
      <label className="qm-label" htmlFor="qm-date">Day</label>
      <input data-clarity-mask="true"
        id="qm-date"
        className="qm-input"
        type="date"
        min={minDate}
        value={data.visitDate}
        onChange={(e) => {
          set({ visitDate: e.target.value });
          // Both modes ask: in-person must know the slot is free, and online fallback hours must still be hours
          // that crew works.
          checkVisitDate(e.target.value, data.service);
        }}
      />
      <span
        className={`qm-ac-status qm-slot${
          dateChecking ? "" : dateFull ? " qm-ac-full" : data.visitDate ? " qm-ac-ok" : ""
        }`}
      >
        {mode === "online" ? (
          data.visitDate ? (
            <>
              <IconCheck className="qm-ac-check" /> We&apos;ll aim for {prettyDay(data.visitDate)} if a visit
              is needed
            </>
          ) : (
            ""
          )
        ) : dateChecking ? (
          "Checking that day…"
        ) : dayOff ? (
          "We're not out that day. Please pick another."
        ) : dateFull ? (
          "That day is full. Please pick another."
        ) : data.visitDate ? (
          <>
            <IconCheck className="qm-ac-check" /> {prettyDay(data.visitDate)} is open
          </>
        ) : (
          `Earliest we can come out is ${VISIT_LEAD_DAYS} days from today.`
        )}
      </span>
      <label className="qm-label">Time</label>
      {/* role=group so screen readers treat the chips as one question. */}
      <div className="qm-chips" role="group" aria-label="Time">
        {slots.map((t) => {
          const taken = takenTimes.includes(t);
          return (
            <button
              key={t}
              type="button"
              disabled={taken}
              title={taken ? "Already booked" : undefined}
              className={`qm-chip${data.visitTime === t ? " qm-chip--active" : ""}${
                taken ? " qm-chip--taken" : ""
              }`}
              onClick={() => set({ visitTime: t })}
            >
              {t}
            </button>
          );
        })}
      </div>

      {/* Send without a time and we call: a missing time costs a phone call, a missing lead costs the job. */}
      <button
        type="button"
        className="qm-text-btn qm-skip"
        disabled={busy}
        onClick={() => {
          track({ event: "done", step: "schedule", mode, ms: stepMs(), detail: "skipped_time" });
          void submit({ skipVisit: true });
        }}
      >
        {mode === "online"
          ? "Skip this and send my request"
          : dateFull || dayOff
            ? "No day works? Send it and we'll call you to set a time"
            : "None of these times work? Send it and we'll call you"}
      </button>

      {/* A rejected date returns as idle, and the reason must come with it. */}
      {(status === "error" || errorMsg) && (
        <p className="qm-err">{errorMsg || `Something went wrong. Please text or call us at ${phoneDisplay} instead.`}</p>
      )}
      {/* The fallback text arrives with what they typed. */}
      {status === "error" && (
        <div className="qm-fallback">
          <a href={smsHref} className="cta-primary qm-full">
            Text us this request
          </a>
          <a href={phoneHref} className="qm-text-btn">
            Or call {phoneDisplay}
          </a>
        </div>
      )}
    </div>
  );
}
