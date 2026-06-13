/**
 * Pixels to scroll a container so the element currently at `moverTop` lands at
 * `targetTop` (both are viewport-relative `top`s). Positive scrolls the
 * container down. Used to line a comment up with its highlighted text (or vice
 * versa) by scrolling exactly one of the two independent panes.
 */
export function scrollOffsetToAlign(moverTop: number, targetTop: number): number {
  return moverTop - targetTop;
}

/**
 * Scroll `scroller` so `mover` lines up vertically with `target`. No-ops if any
 * element is missing, if `scrollBy` is unavailable (e.g. jsdom), or if they're
 * already aligned (sub-pixel). Instant under reduced motion.
 */
export function alignElementToTarget(
  scroller: HTMLElement | null,
  mover: HTMLElement | null,
  target: HTMLElement | null,
  prefersReducedMotion: boolean,
): void {
  if (!scroller || !mover || !target) return;
  if (typeof scroller.scrollBy !== "function") return;
  const delta = scrollOffsetToAlign(
    mover.getBoundingClientRect().top,
    target.getBoundingClientRect().top,
  );
  if (Math.abs(delta) < 1) return;
  scroller.scrollBy({
    top: delta,
    behavior: prefersReducedMotion ? "auto" : "smooth",
  });
}
