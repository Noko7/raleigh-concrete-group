"use client";

import { isValidUsPhone } from "@/lib/quote-submit";

export type Mode = "online" | "inperson";
export type Status = "idle" | "uploading" | "sending" | "success" | "error";

export type FormState = {
  service: string;
  address: string;
  details: string;
  name: string;
  phone: string;
  email: string;
  visitDate: string;
  visitTime: string;
};

export function prettyDay(s: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
  return new Date(`${s}T00:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

export const isValidPhone = isValidUsPhone;

export function StepHead({ n, of, title, sub }: { n: number; of: number; title: string; sub?: string }) {
  return (
    <div className="qm-step-head">
      <p className="qm-step-count">
        Step {n} of {of}
      </p>
      <h2 className="qm-title">{title}</h2>
      {sub && <p className="qm-sub">{sub}</p>}
    </div>
  );
}
