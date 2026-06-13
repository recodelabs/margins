# Comment click — no jump on select — design

**Date:** 2026-06-13
**Status:** Approved (delegated), pending implementation
**Branch:** `fix/comment-click-no-jump`

## Summary

Clicking a comment should open it on a single click without scrolling the page
when the comment is already visible. Today, selecting a comment re-centers its
highlight in the viewport (`block: "center"`), so a comment that's already on
screen jumps — which makes a single click feel like two (the card moves out from
under the cursor, so you click again on the moved card).

## Root cause

`scrollCommentAnchorIntoView` (shipped in the comment-scroll change) always
centers the anchor (`scrollIntoView({ block: "center" })`). With comments now
aligned next to their text, the clicked comment is almost always already
visible, yet `center` still scrolls it to the middle — an unnecessary jump. A
single click already selects + expands the comment (`isExpanded = isSelected` in
the rail); the jump just hides that, creating the two-click feel.

## Fix

Scroll on comment select/add only when needed, minimally: use
`block: "nearest"` instead of `"center"`.

- `nearest` does nothing when the element is already fully visible → **no
  movement** when clicking a visible comment → it opens in place on one click.
- `nearest` nudges the minimum amount when the comment is off-screen → still
  brought into view, no large jump.

This matches Google Docs / Word: selecting a comment doesn't yank the page.

## Components & changes

### `src/comment-scroll.ts`
Change the single `scrollIntoView` call from `block: "center"` to
`block: "nearest"`, and update the doc comment ("centers" → "scrolls into view
only when needed"). No signature change; both call sites (`focusComment` and
`handleAddComment` in `PageCard.tsx`) are unaffected.

## Testing

- **`comment-scroll.test.ts`** — update the two positive cases to expect
  `block: "nearest"` (still asserting `behavior: "smooth"` / `"auto"` for
  reduced motion); the null / no-`scrollIntoView` cases are unchanged.
- **Live verification on `/preview`:** record `window.scrollY`, click the
  comment, confirm `scrollY` is unchanged (the comment is visible) — i.e. no
  jump — and the card is selected/expanded by the single click.

## Out of scope (YAGNI)

- The selected card's `-translate-x-2` shift and the stack re-anchoring on select
  (minor, and arguably desirable). Revisit only if the jump persists after this.

## Delivery

Implemented on `fix/comment-click-no-jump`; PR → merge → pull `main` → deploy →
verify `/preview`.
