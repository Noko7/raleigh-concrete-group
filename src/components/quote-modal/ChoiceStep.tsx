"use client";

import { phoneDisplay, phoneHref } from "@/lib/site-data";
import { IconArrow, IconBolt, IconCalendar } from "./icons";
import type { Mode } from "./shared";

export function ChoiceStep({
  pickMode,
}: {
  pickMode: (next: Mode) => void;
}) {
  return (
    <div className="qm-body">
      <h2 className="qm-title">Get your free quote</h2>
      {/* The whole card is the tap target. */}
      <div className="qm-choices">
        <button className="qm-choice qm-choice--main" onClick={() => pickMode("online")}>
          <span className="qm-choice-icon">
            <IconBolt />
          </span>
          <span className="qm-choice-text">
            <span className="qm-choice-title">Online quote</span>
            <span className="qm-choice-desc">Send a photo. We text you the price.</span>
          </span>
          <IconArrow />
        </button>
        <button className="qm-choice" onClick={() => pickMode("inperson")}>
          <span className="qm-choice-icon">
            <IconCalendar />
          </span>
          <span className="qm-choice-text">
            <span className="qm-choice-title">In-person quote</span>
            <span className="qm-choice-desc">We come out, measure, and give you a written price.</span>
          </span>
          <IconArrow />
        </button>
      </div>
      <p className="qm-choice-foot">
        Rather talk? Call <a href={phoneHref}>{phoneDisplay}</a>
      </p>
    </div>
  );
}
