"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";

// A textarea that grows to fit what is in it, instead of scrolling inside
// itself.
//
// Every multi-line box in this app is filled in on a phone, standing in
// somebody's driveway: the five quote sections, what an option covers, the
// note at the end of a job. A `rows={2}` box is two lines tall on that phone,
// so writing three sentences into one means typing into a slot that scrolls
// away from you, and re-reading it afterwards means scrolling back through a
// window the height of a thumb. Neither is a thing anybody does carefully, and
// the section that is hardest to read back is the one that goes out wrong.
//
// So `rows` becomes a MINIMUM here rather than a fixed height. The box opens at
// that size and grows from there, and nothing inside it is ever out of sight.
//
// Drop-in: same props as <textarea>, controlled or uncontrolled, so every call
// site keeps its own name/value/onChange exactly as it had them.
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
    // Reset first: scrollHeight only ever reports the content's full height
    // when the box is not already taller than it. Without this the box grows
    // and never shrinks back when text is deleted.
    //
    // It also restores the intrinsic height that `rows` asks for, and
    // scrollHeight is never less than that - so `rows` keeps working as the
    // minimum this form was designed around, with no second guess at it here.
    el.style.height = "auto";
    // scrollHeight measures the padding box, so under border-box sizing - which
    // is this app's default - assigning it straight back leaves the box short
    // by its own borders, and every one of them keeps a 2px scroll.
    const s = getComputedStyle(el);
    const borders =
      s.boxSizing === "border-box"
        ? (parseFloat(s.borderTopWidth) || 0) + (parseFloat(s.borderBottomWidth) || 0)
        : 0;
    el.style.height = `${el.scrollHeight + borders}px`;
  }, []);

  // Before paint, not after: measuring in useEffect lets the browser show one
  // frame at the wrong height, which on a page full of these reads as a flinch
  // every time it loads.
  useLayoutEffect(fit, [fit]);
  // A controlled box also has to follow its parent - the crew's form resyncs
  // every field when a save lands, and a box still sized for the old text
  // would clip the new.
  useLayoutEffect(fit, [fit, value]);

  // Fonts land after first paint and change how many lines the text takes.
  // Without this the box is measured against a fallback font and settles a
  // line short of what it needs.
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
        // Sized from the event's own target rather than waiting for the value
        // to come back down as a prop, so an uncontrolled box grows too.
        fit();
        onChange?.(e);
      }}
      onInput={(e) => {
        fit();
        onInput?.(e);
      }}
      // Hidden rather than auto: the element is always exactly as tall as its
      // content, so a scrollbar here would only ever be a flicker mid-keystroke.
      // resize:none because a hand-dragged height is undone by the next keypress.
      style={{ overflow: "hidden", resize: "none", ...style }}
    />
  );
}
