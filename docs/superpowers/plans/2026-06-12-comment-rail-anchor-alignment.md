# Comment Rail Anchor Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Comment cards line up next to their highlighted text by measuring anchor positions in the rail's coordinate frame (the document shell), not the editor's.

**Architecture:** A small `resolveAnchorReferenceElement` helper returns the shared `.document-page-shell` ancestor (the cards' positioning frame). `useCommentAnchorLayout` measures anchor offsets from that element's top instead of the editor's top, removing the ~60px frame offset.

**Tech Stack:** React + TypeScript, TipTap/ProseMirror, Vite, Vitest (`npm test` in `app/`), Biome. All commands run from `app/`.

---

## File Structure

- **Modify** `app/src/document-comments.ts` — add `resolveAnchorReferenceElement`.
- **Create** `app/src/document-comments.test.ts` — its unit test.
- **Modify** `app/src/useCommentAnchorLayout.ts` — measure from the reference element's top.

All work happens on the existing branch `fix/comment-rail-anchor-alignment`.

---

## Task 1: resolveAnchorReferenceElement helper

**Files:**
- Modify: `app/src/document-comments.ts`
- Test: `app/src/document-comments.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/src/document-comments.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveAnchorReferenceElement } from "./document-comments";

describe("resolveAnchorReferenceElement", () => {
  it("returns the .document-page-shell ancestor when the editor is nested in one", () => {
    const shell = document.createElement("div");
    shell.className = "document-page-shell";
    const editor = document.createElement("div");
    shell.appendChild(editor);

    expect(resolveAnchorReferenceElement(editor)).toBe(shell);
  });

  it("returns the editor element itself when there is no shell ancestor", () => {
    const editor = document.createElement("div");
    expect(resolveAnchorReferenceElement(editor)).toBe(editor);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/document-comments.test.ts`
Expected: FAIL — `resolveAnchorReferenceElement` is not exported.

- [ ] **Step 3: Add the helper**

In `app/src/document-comments.ts`, add this exported function (place it near the
other anchor helpers, e.g. just above `getCommentAnchorMeasurements`):

```ts
/**
 * The element whose top is the measurement origin for comment anchors: the
 * shared `.document-page-shell` grid that the editor column and the comment rail
 * both align to. Comment cards are absolutely positioned inside the rail
 * container (which starts at the shell top), so measuring anchor offsets from
 * the shell — not the editor (which sits lower by the document card's padding) —
 * makes each card line up with its highlighted text. Falls back to the editor
 * element when no shell ancestor exists.
 */
export function resolveAnchorReferenceElement(
  editorElement: HTMLElement,
): HTMLElement {
  return (
    (editorElement.closest(".document-page-shell") as HTMLElement | null) ??
    editorElement
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/document-comments.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/document-comments.ts app/src/document-comments.test.ts
git commit -m "feat: add resolveAnchorReferenceElement (shell-relative anchor origin)"
```

---

## Task 2: Measure anchors from the reference element in useCommentAnchorLayout

**Files:**
- Modify: `app/src/useCommentAnchorLayout.ts`

Context: the current `measureLayout` computes `editorRect` and calls
`getCommentAnchorMeasurements(anchorElements, editorRect.top, 1)`. We change only
the measurement origin.

- [ ] **Step 1: Add the import**

In `app/src/useCommentAnchorLayout.ts`, add `resolveAnchorReferenceElement` to the
existing import from `./document-comments`:

```ts
import {
  type CommentGroupAnchor,
  getCommentAnchorMeasurements,
  groupCommentAnchorMeasurements,
  resolveAnchorReferenceElement,
} from "./document-comments";
```

- [ ] **Step 2: Measure from the reference element's top**

In `measureLayout`, replace this block:

```ts
      const editorRect = editorElement.getBoundingClientRect();
      const anchorElements = editorElement.querySelectorAll<HTMLElement>(
        ".comment-anchor[data-comment-ids]",
      );
      const measurements = getCommentAnchorMeasurements(
        anchorElements,
        editorRect.top,
        1,
      );

      setLayoutState({
        commentGroups: groupCommentAnchorMeasurements(measurements),
        contentHeight: editorRect.height,
      });
```

with:

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
        contentHeight: editorRect.height,
      });
```

(`contentHeight` stays `editorRect.height` — it feeds the rail's `minHeight`, not
the card positions.)

- [ ] **Step 3: Build + test**

Run: `cd app && VITE_GITHUB_MODE=1 npm run build`
Expected: PASS — `tsc -b` clean, `vite build` succeeds.

Run: `cd app && npm test`
Expected: PASS — full suite green.

- [ ] **Step 4: Commit**

```bash
git add app/src/useCommentAnchorLayout.ts
git commit -m "fix: align comment cards to their text by measuring anchors from the shell"
```

---

## Task 3: Verification

**Files:** none (verification only)

- [ ] **Step 1: Full suite + lint**

Run: `cd app && npm test` — Expected: all green.
Run: `cd app && npx biome check src/document-comments.ts src/document-comments.test.ts src/useCommentAnchorLayout.ts` — Expected: no errors (run `--write` if formatting flagged, then re-commit).

- [ ] **Step 2: Confirm wiring**

Run: `cd app && grep -n "resolveAnchorReferenceElement\|referenceTop" src/useCommentAnchorLayout.ts`
Expected: the import and the `referenceTop` measurement are present; `editorRect.top` is no longer passed to `getCommentAnchorMeasurements`.

- [ ] **Step 3: Live measurement (after deploy)**

Load `/preview` and compare the comment anchor's viewport `top` to the card's
viewport `top` — they should be approximately equal (within a few px), versus the
~60px gap before. Specifically:
- `document.querySelector('.comment-anchor[data-comment-ids]').getBoundingClientRect().top`
- `document.querySelector('[data-comment-thread-container]').getBoundingClientRect().top`

---

## Self-Review (completed by plan author)

**Spec coverage:**
- Measure anchors from the shell, not the editor → Task 1 (helper) + Task 2 (use it).
- Fallback to editor when no shell → Task 1 (`?? editorElement`) + its test.
- `contentHeight` unchanged → Task 2 Step 2 note.
- Live verification of alignment → Task 3 Step 3.

**Placeholder scan:** No TBD/TODO; every code step shows complete code.

**Type consistency:** `resolveAnchorReferenceElement(editorElement: HTMLElement): HTMLElement` is identical in the helper (Task 1), its test (Task 1), and the call site (Task 2). It returns an `HTMLElement`, so `.getBoundingClientRect().top` in Task 2 is valid. `getCommentAnchorMeasurements(anchorElements, referenceTop: number, 1)` matches its existing `(elements, containerTop, measurementScale)` signature.
