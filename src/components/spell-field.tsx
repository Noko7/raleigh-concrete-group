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
import { loadSpeller, type Speller } from "@/lib/spell/speller";
import { findMisspellings, type Misspelling } from "@/lib/spell/words";

// Quote fields with a red squiggle under misspelled words. The squiggles are drawn on a see-through copy of the text
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

  useEffect(() => {
    let live = true;
    loadSpeller().then((s) => live && setSpeller(s));
    return () => {
      live = false;
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

  return (
    <div className="sp-wrap">
      {children(fieldRef, handlers)}
      {speller && (
        <div ref={overlayRef} className={multiline ? "sp-overlay" : "sp-overlay sp-overlay-line"} aria-hidden="true">
          <Marked text={text} issues={issues} />
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
