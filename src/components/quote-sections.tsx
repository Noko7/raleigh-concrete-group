import { SectionText } from "./section-text";

// "What's included", shared by the customer's quote page and the crew's live preview so they can't drift.
// No "use client": rendered on the server for customers and in the browser for the crew.

// Short answers sit on their label's row; longer ones go below it.
const SHORT_ANSWER = 32;
// Shown quieter so the sections with real work stand out.
const NOTHING_RE = /^(n\/?a|not applicable|none|not needed|no permits? (needed|required))\.?$/i;

export function QuoteSections({ sections }: { sections: ReadonlyArray<readonly [label: string, value: string]> }) {
  return (
    <ol className="cq-steps">
      {sections.map(([label, raw]) => {
        const value = raw.trim();
        const short = value.length <= SHORT_ANSWER && !value.includes("\n");
        const nothing = NOTHING_RE.test(value);
        return (
          <li key={label} className={`cq-step${short ? " cq-step-short" : ""}${nothing ? " cq-step-nothing" : ""}`}>
            <h3 className="cq-step-label">{label}</h3>
            {short ? <p className="cq-step-text">{value}</p> : <SectionText text={value} />}
          </li>
        );
      })}
    </ol>
  );
}
