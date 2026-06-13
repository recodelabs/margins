/**
 * Scrolls a comment-related element (a highlight anchor in the body, or a
 * comment card in the rail) into view. `block` controls how much:
 * - `"nearest"` (default) leaves the page put when the element is already fully
 *   visible and nudges the minimum amount otherwise — for selecting a comment
 *   without jumping the page.
 * - `"center"` centers it — a deliberate "jump to this comment" used when
 *   clicking a body highlight or adding a comment, so the target is clearly
 *   brought into view.
 * Instant when the user prefers reduced motion. No-ops for a missing element, or
 * when `scrollIntoView` is unavailable (e.g. jsdom).
 */
export function scrollCommentAnchorIntoView(
  element: HTMLElement | null,
  prefersReducedMotion: boolean,
  block: "nearest" | "center" = "nearest",
): void {
  if (!element || typeof element.scrollIntoView !== "function") return;
  element.scrollIntoView({
    behavior: prefersReducedMotion ? "auto" : "smooth",
    block,
  });
}
