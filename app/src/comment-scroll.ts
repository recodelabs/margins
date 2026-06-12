/**
 * Smoothly centers a comment's anchor element in the viewport (instant when the
 * user prefers reduced motion). The absolutely-positioned rail card follows the
 * document scroll, so centering the anchor brings both into view. No-ops for a
 * missing anchor, or when `scrollIntoView` is unavailable (e.g. jsdom).
 */
export function scrollCommentAnchorIntoView(
  anchor: HTMLElement | null,
  prefersReducedMotion: boolean,
): void {
  if (!anchor || typeof anchor.scrollIntoView !== "function") return;
  anchor.scrollIntoView({
    behavior: prefersReducedMotion ? "auto" : "smooth",
    block: "center",
  });
}
