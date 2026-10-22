"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";

import { AutoTextarea } from "@/components/auto-textarea";
import { loadSpeller, onWordsChanged, type Speller } from "@/lib/spell/speller";
import { findMisspellings, matchCase, replaceAt, type Misspelling } from "@/lib/spell/words";

// Quote fields with a red squiggle under misspelled words and, below the box,
// one-tap fixes. The squiggles are drawn on a see-through copy of the text
// laid exactly over the field (pointer-events off, so every tap still lands in
// the field); the field itself is untouched, so typing, autocorrect and
// selection behave as before. The browser's own checker is switched off here,
// or Chrome would draw a second set of lines.

type Field = HTMLTextAreaElement | HTMLInputElement;

// Copied from the field so the overlay's text wraps exactly where the field's does.
const MIRRORED = [
  "fontFamily", "fontSize", "fontWeight", "fontStyle", "fontStretch", "letterSpacing", "wordSpacing",
  "lineHeight", "textTransform", "textIndent", "textAlign", "direction", "tabSize", "boxSizing",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
] as const;

// More than this and the list under the box becomes its own wall of text.
const MAX_FIXES = 6;

export function SpellTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <SpellShell multiline value={props.value} defaultValue={props.defaultValue}>
      {(ref, handlers) => (
        <AutoTextarea
          {...props}
          ref={ref as React.Ref<HTMLTextAreaElement>}
          spellCheck={false}
          autoCorrect="on"
          onInput={(e) => {
            handlers.onInput();
            props.onInput?.(e);
          }}
          onFocus={(e) => {
            handlers.onFocus();
            props.onFocus?.(e);
          }}
          onBlur={(e) => {
            handlers.onBlur();
            props.onBlur?.(e);
          }}
          onScroll={(e) => {
            handlers.onScroll();
            props.onScroll?.(e);
          }}
          onSelect={(e) => {
            handlers.onInput();
            props.onSelect?.(e);
          }}
        />
      )}
    </SpellShell>
  );
}

export function SpellInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <SpellShell multiline={false} value={props.value} defaultValue={props.defaultValue}>
      {(ref, handlers) => (
        <input
          {...props}
          ref={ref as React.Ref<HTMLInputElement>}
          spellCheck={false}
          autoCorrect="on"
          onInput={(e) => {
            handlers.onInput();
            props.onInput?.(e);
          }}
          onFocus={(e) => {
            handlers.onFocus();
            props.onFocus?.(e);
          }}
          onBlur={(e) => {
            handlers.onBlur();
            props.onBlur?.(e);
          }}
          onScroll={(e) => {
            handlers.onScroll();
            props.onScroll?.(e);
          }}
          onSelect={(e) => {
            handlers.onInput();
            props.onSelect?.(e);
          }}
        />
      )}
    </SpellShell>
  );
}

type Handlers = { onInput(): void; onFocus(): void; onBlur(): void; onScroll(): void };

function SpellShell({
  multiline,
  value,
  defaultValue,
  children,
}: {
  multiline: boolean;
  value: unknown;
  defaultValue: unknown;
  children: (ref: React.RefObject<Field | null>, handlers: Handlers) => ReactNode;
}) {
  const fieldRef = useRef<Field | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [speller, setSpeller] = useState<Speller | null>(null);
  const [text, setText] = useState(() => String(value ?? defaultValue ?? ""));
  const [caret, setCaret] = useState<number | null>(null);
  const [, setWordsVersion] = useState(0);

  useEffect(() => {
    let live = true;
    loadSpeller().then((s) => live && setSpeller(s));
    const off = onWordsChanged(() => setWordsVersion((v) => v + 1));
    return () => {
      live = false;
      off();
    };
  }, []);

  // Controlled fields change from outside too (a save resyncs them).
  useEffect(() => {
    if (value !== undefined) setText(String(value ?? ""));
  }, [value]);

  // Place the overlay over the field, matching its box and type exactly.
  const place = useCallback(() => {
    const el = fieldRef.current;
    const ov = overlayRef.current;
    if (!el || !ov) return;
    const cs = getComputedStyle(el);
    for (const p of MIRRORED) ov.style[p] = cs[p];
    ov.style.top = `${el.offsetTop}px`;
    ov.style.left = `${el.offsetLeft}px`;
    ov.style.width = `${el.offsetWidth}px`;
    ov.style.height = `${el.offsetHeight}px`;
    ov.scrollTop = el.scrollTop;
    ov.scrollLeft = el.scrollLeft;
  }, []);

  useLayoutEffect(() => {
    place();
    const el = fieldRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [place]);
  useLayoutEffect(place, [place, text, speller]);

  const read = () => {
    const el = fieldRef.current;
    if (!el) return;
    setText(el.value);
    setCaret(document.activeElement === el ? el.selectionStart : null);
  };
  const handlers: Handlers = {
    onInput: read,
    onFocus: read,
    onBlur: () => setCaret(null),
    onScroll: place,
  };

  // The word being typed isn't marked until the caret leaves it: "concre" is
  // only wrong once they've stopped typing.
  const issues = speller
    ? findMisspellings(text, speller.isWord).filter((m) => caret === null || caret < m.start || caret > m.end)
    : [];

  // Every occurrence of a misspelling is fixed by one tap.
  const fixes = new Map<string, Misspelling[]>();
  for (const m of issues) fixes.set(m.word, [...(fixes.get(m.word) ?? []), m]);

  const apply = (word: string, replacement: string) => {
    const el = fieldRef.current;
    if (!el) return;
    let next = el.value;
    // From the end, so earlier positions stay right.
    for (const m of [...(fixes.get(word) ?? [])].reverse()) {
      if (next.slice(m.start, m.end) === word) next = replaceAt(next, m.start, m.end, replacement);
    }
    setNativeValue(el, next);
    setText(next);
  };

  return (
    <div className="sp-wrap">
      {children(fieldRef, handlers)}
      {speller && (
        <div ref={overlayRef} className={multiline ? "sp-overlay" : "sp-overlay sp-overlay-line"} aria-hidden="true">
          <Marked text={text} issues={issues} />
        </div>
      )}
      {speller && fixes.size > 0 && (
        <div className="sp-fixes" role="group" aria-label="Spelling">
          {[...fixes.entries()].slice(0, MAX_FIXES).map(([word, at]) => {
            const fix = at[0].meant ?? speller.suggest(word)[0];
            return (
              <span key={word} className="sp-fix">
                {fix ? (
                  <button type="button" className="sp-fix-btn" onClick={() => apply(word, matchCase(fix, word))}>
                    <s>{word}</s> <span aria-hidden="true">→</span> <strong>{matchCase(fix, word)}</strong>
                  </button>
                ) : (
                  <span className="sp-fix-word">{word}</span>
                )}
                {/* A confusable is a real word; "Add" is for names and terms the dictionary lacks. */}
                {!at[0].meant && (
                  <button type="button" className="sp-add" onClick={() => speller.addOwn(word)} title="Add to dictionary">
                    Add
                  </button>
                )}
              </span>
            );
          })}
          {fixes.size > MAX_FIXES && <span className="sp-more">+{fixes.size - MAX_FIXES} more</span>}
        </div>
      )}
    </div>
  );
}

// The text again, see-through, with each misspelling underlined in place.
function Marked({ text, issues }: { text: string; issues: Misspelling[] }) {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const m of issues) {
    if (m.start > at) parts.push(text.slice(at, m.start));
    parts.push(
      <span key={m.start} className="sp-bad">
        {text.slice(m.start, m.end)}
      </span>,
    );
    at = m.end;
  }
  // A trailing newline still needs its line, or the last row sits one line short.
  parts.push(`${text.slice(at)}​`);
  return <>{parts}</>;
}

// Set the value the way typing does, so a controlled field's onChange runs and
// the form's state (and Save) see the fix.
function setNativeValue(el: Field, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}
