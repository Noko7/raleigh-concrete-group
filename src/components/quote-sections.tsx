import { SectionText } from "./section-text";

// The "What's included" list, exactly as the customer reads it. One component
// for both places it appears - the customer's quote page and the live preview
// under the crew's quote form - so what the crew checks before sending is the
// thing the customer gets, not a lookalike that can drift from it.
//
// No "use client": the customer page renders it on the server, the crew's form
// renders it in the browser, and SectionText is the only piece that needs state.

// A one-liner answer ("Not applicable", "Included", "By the crew") sits on the
// same row as its label instead of taking two lines on its own. Anything
// longer gets the label above and the text below.
const SHORT_ANSWER = 32;
// "Nothing to do here" answers, shown quieter so the sections that are real
// work stand out.
const NOTHING_RE = /^(n\/?a|not applicable|none|not needed|no permits? (needed|required))\.?$/i;

export function QuoteSections({ sections }: { sections: ReadonlyArray<readonly [label: string, value: string]> }) {
  return (
    // The sections are the job in the order it happens, so they read as one
    // line down the side with a stop for each. Whatever length each answer is,
    // the line keeps them looking like one list.
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
