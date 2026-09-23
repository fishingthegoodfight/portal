"use client";

import { useEffect, useRef, type HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

/**
 * Brings an element into view and gives it keyboard focus when it appears —
 * for a confirmation panel, inline warning or error shown in response to a
 * click. Without this, a panel that opens below the fold (or above it, or
 * inside a scrolled modal) looks like the click did nothing.
 *
 * "nearest" scrolls only as far as needed (not at all when it's already fully
 * visible) and works inside scrollable containers like the admin modals.
 * Focus goes to the panel itself, not its first button, so Enter can't
 * confirm something by accident — unless focus is already inside it (e.g. an
 * autoFocus field), which is left alone. `revealKey`: reveal again when this changes
 * while the element stays mounted (e.g. a different warning in the same slot).
 */
export function useRevealOnMount<T extends HTMLElement>(revealKey?: unknown) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
    if (!el.contains(document.activeElement)) el.focus({ preventScroll: true });
  }, [revealKey]);
  return ref;
}

/** A div that reveals itself on mount (see useRevealOnMount). Defaults to
 * role="alertdialog" — pass role="alert" for a warning/error with no choices. */
export function RevealPanel({
  revealKey,
  className,
  role = "alertdialog",
  ...props
}: HTMLAttributes<HTMLDivElement> & { revealKey?: unknown }) {
  const ref = useRevealOnMount<HTMLDivElement>(revealKey);
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role={role}
      className={cn("scroll-my-4 outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}
      {...props}
    />
  );
}
