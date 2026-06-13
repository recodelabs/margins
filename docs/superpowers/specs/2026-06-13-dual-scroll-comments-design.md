# Dual-scroll comments (independent body / margin) — design

**Date:** 2026-06-13
**Status:** Pending user review
**Branch:** `feat/dual-scroll-comments`

## Goal

Make the document body and the comment margin two **independent scroll areas**,
so:

- **Click a comment in the margin** → the **body** scrolls so its highlighted
  text lines up with the comment; the **margin stays still** (you reply in
  place).
- **Click a highlight in the body** → the **margin** scrolls so the comment lines
  up with the text; the **body stays still**.
- **Add a comment** → the **margin** scrolls so the new comment lands next to its
  highlighted text (so you can see where it opened).

Principle: *the side you click is the anchor and stays put; the other side moves
to line up with it.*

## Current structure (the constraint)

`DocumentWorkspace.tsx:619` is a single `overflow-y-auto` scroll container that
holds the breadcrumb **and** `PageCard`. Inside `PageCard`, a grid lays out the
body column (the editor card) and the rail column (`DocumentReviewRail`, an
`<aside>` whose comment cards are absolutely positioned by document-Y). Because
both columns live in that one scroller, they scroll together — which is why one
can't stay still while the other moves.

The rail only renders at ≥1100px (`min-[1100px]:block`); below that the rail is
hidden and comments fall back to an inline list. So dual-scroll applies only at
≥1100px; the narrow layout is unchanged.

## Approach: sticky, independently-scrolling rail (low-risk, localized)

Rather than restructure the whole content area (high risk), make **only the rail
independent**:

1. The body keeps scrolling in the existing `DocumentWorkspace` container
   (tag it `data-document-scroller` for lookup).
2. The rail `<aside>` becomes its own scroll area pinned in the viewport:
   `position: sticky; top: 0; align-self: start; height: <scroller viewport
   height>; overflow-y: auto`, tagged `data-comment-rail-scroller`. Its inner
   container keeps the absolutely-positioned cards (height = `railHeight`), which
   now scroll **within** the sticky rail instead of with the page.
   - Height: set to the scroller's visible height (via a CSS `100%` against the
     fixed-height shell, or a measured pixel height) so the rail is exactly one
     viewport tall and scrolls internally. Verified empirically on `/preview`.
3. No auto-sync between the two (the user picked "two separate scroll areas").
   Normal wheel-scroll moves each area on its own; the click gestures below do
   the lining-up.

## Click-to-align logic

Helpers (pure, testable) computing a scroll delta from two elements' current
viewport `top`s:

- `alignBodyToComment`: `delta = anchorTop - cardTop` → `bodyScroller.scrollBy({
  top: delta, behavior })` (brings the highlight up/down to the comment's level).
- `alignRailToBody`: `delta = cardTop - anchorTop` → `railScroller.scrollBy({
  top: delta, behavior })` (brings the comment to the highlight's level).

`behavior` = `smooth`, or `auto` under `prefers-reduced-motion`.

Wiring in `PageCard`:

- **Card-click** (`focusComment`): set a `suppressRailAlignRef` flag, select the
  comment, then `alignBodyToComment` (scroll the body; rail stays). The flag
  stops the body-click path below from also scrolling the rail (clicking a card
  drives the editor selection, which would otherwise look like a body-click).
- **Body-click** (cursor enters a comment → `activeCommentIds` →
  `selectedCommentId` effect): if `suppressRailAlignRef` is set, consume it and
  do nothing (it was a card-click); else `alignRailToBody` (scroll the rail; body
  stays).
- **Add comment** (`handleAddComment`): after the new card renders,
  `alignRailToBody` for it (scroll the rail so the new comment sits next to its
  highlighted text — fixes "can't see where it opened").

Scroller + element lookup by `data-*` attribute (no heavy ref plumbing):
`document.querySelector('[data-document-scroller]')`,
`[data-comment-rail-scroller]`, the highlight via the existing
`findCommentAnchorElement`, the card via `[data-comment-root-id="…"]`.

## Out of scope (YAGNI)

- Auto-syncing the two panes while wheel-scrolling (user explicitly wants
  separate areas).
- The narrow (<1100px) layout (unchanged).
- Re-pivoting/reshuffling the rail stack on selection (kept stable — alignment is
  by scrolling, not re-stacking).

## Testing

- Unit: `alignBodyToComment` / `alignRailToBody` delta math (pure functions) —
  given anchor/card tops, assert the computed scroll delta and target scroller.
- Live on the 3-comment `/preview` (resized short for scroll room): clicking a
  margin comment scrolls only the body to its text; clicking a highlight scrolls
  only the rail to the comment; adding a comment scrolls the rail to the new one.
  jsdom has no layout/scroll, so the integration is verified live.

## Risk & rollback

The sticky-rail CSS is the main risk (height/overflow). Implement behind the
≥1100px breakpoint, verify the editor still scrolls and looks right on
`/preview` before shipping; if the sticky height misbehaves, fall back to the
stabilized (no-scroll) state already on `main`.

## Delivery

`feat/dual-scroll-comments`; PR → merge → deploy → verify `/preview`.
