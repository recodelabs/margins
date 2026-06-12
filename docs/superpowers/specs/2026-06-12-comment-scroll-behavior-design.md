# Comment scroll behavior — design

**Date:** 2026-06-12
**Status:** Approved, pending implementation
**Branch:** `feat/comment-scroll-behavior`

## Summary

Two comment-interaction scroll fixes in the document workspace:

1. **Click a comment → scroll the document to its highlight.** Selecting a comment
   in the rail highlights the text but doesn't move the page, so you often can't
   see it. It should smoothly scroll the highlighted text to the center of the
   view.
2. **Add a comment → stop the jump to the bottom.** Adding a comment mid-page
   sometimes scrolls the page to the bottom (because the new comment's rail
   textarea is focused, and a plain `focus()` yanks the page to it). It should
   keep your position and keep the newly-commented text + its comment box in
   view.

The rail card auto-follows the document scroll because each card is absolutely
positioned at its anchor's vertical offset (`DocumentCommentRail.tsx:195`).

## Decisions (resolved during brainstorming)

| Question | Decision |
|----------|----------|
| Click → scroll style | Smooth, centered; instant when the OS prefers reduced motion. |
| Add → scroll behavior | Stop the jump-to-bottom; keep position and center the new comment's text/box so it stays visible. |
| "Zoom on the left" | Means scroll the document pane to the highlight, not literal magnification. |

## Root causes (from investigation)

- **#1:** `focusComment` (`PageCard.tsx:1595`) sets the selection but calls
  `focus(…, { scrollIntoView: false })` — it never scrolls the document to the
  highlighted range/anchor.
- **#2:** After `handleAddComment` sets `pendingFocusCommentId`,
  `CommentEditorList.tsx:182` calls `target.focus()` on the new comment's
  textarea. A plain `focus()` scrolls the focused element into view, dragging the
  page (often to the bottom).

## Components & changes

### New: `src/comment-scroll.ts`
A small, unit-testable helper that centers a comment anchor in the viewport:

```ts
export function scrollCommentAnchorIntoView(
  anchor: HTMLElement | null,
  prefersReducedMotion: boolean,
) {
  if (!anchor) return;
  anchor.scrollIntoView({
    behavior: prefersReducedMotion ? "auto" : "smooth",
    block: "center",
  });
}
```

### `src/PageCard.tsx`
- Add a `prefersReducedMotion()` helper wrapping
  `window.matchMedia("(prefers-reduced-motion: reduce)")` (guarded for absence).
- **`focusComment`** (#1): after setting the selection, call
  `scrollCommentAnchorIntoView(findCommentAnchorElement(currentEditor, commentId), prefersReducedMotion())`.
  Do the same in the anchor-only branch (no text range).
- **`handleAddComment`** (#2): in the existing `requestAnimationFrame` (after
  `measureLayout()`), also call
  `scrollCommentAnchorIntoView(findCommentAnchorElement(currentEditor, comment.id), prefersReducedMotion())`
  so the new comment's text is centered/visible rather than the page ending up at
  the bottom.

### `src/CommentEditorList.tsx`
- Line 182: `target.focus()` → `target.focus({ preventScroll: true })`. This stops
  the browser from scrolling the page to the newly-focused rail textarea; the
  controlled `scrollCommentAnchorIntoView` handles visibility instead.

## Error handling / edge cases

- A null anchor (comment not yet rendered, or anchor-less) is a no-op in the
  helper — no throw.
- `window.matchMedia` absence (non-browser/jsdom) is guarded; treated as "not
  reduced motion".
- `scrollIntoView`'s `{ block: "center" }` scrolls the window (the document's
  scroll container), bringing the highlight into the middle of the viewport; the
  absolutely-positioned rail card follows.

## Testing

- **`comment-scroll.test.ts`** — `scrollCommentAnchorIntoView`:
  - calls `anchor.scrollIntoView({ behavior: "smooth", block: "center" })` when
    not reduced-motion (spy element),
  - uses `behavior: "auto"` when `prefersReducedMotion` is true,
  - does nothing for a `null` anchor.
- The DOM-integration parts (which anchor, when) are verified by manual smoke
  test — jsdom's `scrollIntoView`/`matchMedia` are inert, so an integration test
  there would assert nothing meaningful.

## Out of scope (YAGNI)

- Changing the rail's positioning model.
- Hover-to-scroll, keyboard navigation between comments.

## Delivery

Implemented on `feat/comment-scroll-behavior`; PR → merge → pull `main` → deploy
to Cloudflare (same flow as prior changes).
