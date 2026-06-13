/**
 * Scrolls a comment's anchor element into view, but only as much as needed:
 * `block: "nearest"` leaves the page put when the anchor is already fully
 * visible (so clicking a visible comment doesn't jump), and nudges the minimum
 * amount when it's off-screen. Instant when the user prefers reduced motion. The
 * absolutely-positioned rail card follows the document scroll, so the comment
 * and its highlight stay together. No-ops for a missing anchor, or when
 * `scrollIntoView` is unavailable (e.g. jsdom).
 */
export function scrollCommentAnchorIntoView(
  anchor: HTMLElement | null,
  prefersReducedMotion: boolean,
): void {
  if (!anchor || typeof anchor.scrollIntoView !== "function") return;
  anchor.scrollIntoView({
    behavior: prefersReducedMotion ? "auto" : "smooth",
    block: "nearest",
  });
}
