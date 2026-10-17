"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";

// A textarea that grows to fit its content. Everything multi-line here is written on a phone, where a
// fixed `rows={2}` box scrolls the text out of sight. `rows` becomes a MINIMUM.
// Drop-in: same props as <textarea>, controlled or uncontrolled.
export function AutoTextarea({
  value,
  onChange,
  onInput,
  style,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // Reset first: scrollHeight only reports full content height when the box isn't already taller, so
    // without this it never shrinks. "auto" also restores the `rows` minimum.
    el.style.height = "auto";
    // scrollHeight is the padding box; under border-box sizing add the borders or it keeps a 2px scroll.
    const s = getComputedStyle(el);
    const borders =
      s.boxSizing === "border-box"
        ? (parseFloat(s.borderTopWidth) || 0) + (parseFloat(s.borderBottomWidth) || 0)
        : 0;
    el.style.height = `${el.scrollHeight + borders}px`;
  }, []);

  // Before paint: useEffect shows one frame at the wrong height.
  useLayoutEffect(fit, [fit]);
  // Controlled boxes follow the parent (forms resync fields after a save).
  useLayoutEffect(fit, [fit, value]);

  // Web fonts land after first paint and change the line count.
  useEffect(() => {
    const fonts = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts;
    if (!fonts?.ready) return;
    let live = true;
    fonts.ready.then(() => {
      if (live) fit();
    });
    return () => {
      live = false;
    };
  }, [fit]);

  return (
    <textarea
      {...rest}
      ref={ref}
      value={value}
      onChange={(e) => {
        // From the event target, so uncontrolled boxes grow too.
        fit();
        onChange?.(e);
      }}
      onInput={(e) => {
        fit();
        onInput?.(e);
      }}
      // Hidden: it's always exactly content height, so a scrollbar would only flicker. resize:none because a
      // dragged height is undone by the next keypress.
      style={{ overflow: "hidden", resize: "none", ...style }}
    />
  );
}
