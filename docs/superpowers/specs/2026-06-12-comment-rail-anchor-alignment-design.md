# Comment rail anchor alignment — design

**Date:** 2026-06-12
**Status:** Approved, pending implementation
**Branch:** `fix/comment-rail-anchor-alignment`

## Summary

Comment cards in the review rail are vertically offset from their highlighted
text. Make each card line up next to its highlighted text (Google Docs / Word),
by measuring comment anchor positions in the same coordinate frame the cards are
positioned in.

## Root cause (measured live on `/preview`)

| Element | viewport `top` |
|---------|----------------|
| Highlighted text (comment anchor) | 335px |
| Comment card in rail | 275px |
| Editor content top | 136px |
| Rail container top (= document shell top) | 76px |

`useCommentAnchorLayout` measures anchor offsets relative to the **editor**
element's top (`editorRect.top`, 136px), but the cards are absolutely positioned
inside the **rail container**, whose top is the document shell top (76px) — ~60px
higher (the document card's `py-14` top padding). So `railTop` (the card's `top`
style) correctly equals the anchor's offset *from the editor*, but it's applied
in a container that starts ~60px higher → every card is shifted ~60px from its
text.

Why it looks inconsistent ("sometimes fine"): the ~60px base offset is small
enough that a well-spaced comment's text line still falls inside its tall card
(reads as aligned), while a crowded comment gets the base offset *plus* the
rail's cumulative overlap-avoidance push-down, so it drifts "a lot." Same root
cause, amplified by crowding.

## Fix

Measure anchor offsets relative to the **document shell** (`.document-page-shell`)
— the grid container that both the editor column and the rail column align to
(`railContainerTop === shellTop`, confirmed both 76px) — instead of the editor
element. Then each card's `top` equals its anchor's vertical position, so the
comment sits exactly beside its highlighted text.

The existing overlap-avoidance stacking (`resolveAnchoredRailLayouts`) is
unchanged: with a correct baseline, a well-spaced comment lands exactly beside
its text, and a crowded one nudges down only enough to not overlap its neighbor —
which is what Word/Google Docs do.

## Components & changes

### `src/document-comments.ts`
Add a small pure helper:

```ts
export function resolveAnchorReferenceElement(
  editorElement: HTMLElement,
): HTMLElement {
  return (
    (editorElement.closest(".document-page-shell") as HTMLElement | null) ??
    editorElement
  );
}
```

Returns the shared shell ancestor (the cards' positioning frame), or the editor
element itself if the shell isn't found (safe fallback — preserves today's
behavior).

### `src/useCommentAnchorLayout.ts`
In `measureLayout`, use the reference element's top as the measurement origin
instead of `editorRect.top`:

```ts
const editorRect = editorElement.getBoundingClientRect();
const referenceTop = resolveAnchorReferenceElement(editorElement)
  .getBoundingClientRect()
  .top;
const anchorElements = editorElement.querySelectorAll<HTMLElement>(
  ".comment-anchor[data-comment-ids]",
);
const measurements = getCommentAnchorMeasurements(
  anchorElements,
  referenceTop,
  1,
);
setLayoutState({
  commentGroups: groupCommentAnchorMeasurements(measurements),
  contentHeight: editorRect.height, // unchanged — the editor's own height
});
```

`contentHeight` stays the editor's height (used only for the rail's `minHeight`),
so the change is isolated to where anchors are measured *from*.

## Edge cases

- Shell not found (e.g. a future layout, or a detached editor in tests) →
  falls back to the editor element → today's behavior, no crash.
- Embedded-demo layout uses a `flow` rail (not absolutely positioned), so the
  reference change is harmless there; the shell class is present in both layouts.

## Testing

- **`document-comments.test.ts`** (new) — `resolveAnchorReferenceElement`:
  - returns the `.document-page-shell` ancestor when the editor is nested in one,
  - returns the editor element itself when no shell ancestor exists.
- **Live verification:** after the fix, re-measure `/preview` — the comment
  anchor's viewport `top` should ≈ the card's viewport `top` (was off by ~60px).
  jsdom has no layout, so the pixel alignment can only be checked live.

## Out of scope (YAGNI)

- Redesigning the overlap-avoidance stacking (already correct).
- Horizontal connector lines between text and comment.

## Delivery

Implemented on `fix/comment-rail-anchor-alignment`; PR → merge → pull `main` →
deploy to Cloudflare → re-measure `/preview`.
