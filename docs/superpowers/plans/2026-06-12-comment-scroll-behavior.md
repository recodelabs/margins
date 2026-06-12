# Comment Scroll Behavior Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking a comment smoothly scrolls the document to its highlighted text; adding a comment mid-page no longer jumps to the bottom.

**Architecture:** A small `scrollCommentAnchorIntoView` helper centers a comment's anchor element in the viewport (instant under reduced motion). `PageCard.focusComment` and `handleAddComment` call it; `CommentEditorList` focuses the new comment's textarea with `preventScroll` so the browser stops yanking the page.

**Tech Stack:** React + TypeScript, TipTap/ProseMirror, Vite, Vitest (`npm test` in `app/`), Biome. All commands run from `app/`.

---

## File Structure

- **Create** `app/src/comment-scroll.ts` — the anchor-centering helper.
- **Create** `app/src/comment-scroll.test.ts` — its unit test.
- **Modify** `app/src/PageCard.tsx` — `prefersReducedMotion()` + calls in `focusComment` and `handleAddComment`.
- **Modify** `app/src/CommentEditorList.tsx` — `focus({ preventScroll: true })`.

All work happens on the existing branch `feat/comment-scroll-behavior`.

---

## Task 1: scrollCommentAnchorIntoView helper

**Files:**
- Create: `app/src/comment-scroll.ts`
- Test: `app/src/comment-scroll.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/src/comment-scroll.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { scrollCommentAnchorIntoView } from "./comment-scroll";

function fakeAnchor() {
  return { scrollIntoView: vi.fn() } as unknown as HTMLElement;
}

describe("scrollCommentAnchorIntoView", () => {
  it("smooth-centers the anchor when reduced motion is not preferred", () => {
    const anchor = fakeAnchor();
    scrollCommentAnchorIntoView(anchor, false);
    expect(anchor.scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
    });
  });

  it("uses an instant scroll when reduced motion is preferred", () => {
    const anchor = fakeAnchor();
    scrollCommentAnchorIntoView(anchor, true);
    expect(anchor.scrollIntoView).toHaveBeenCalledWith({
      behavior: "auto",
      block: "center",
    });
  });

  it("does nothing for a null anchor", () => {
    expect(() => scrollCommentAnchorIntoView(null, false)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/comment-scroll.test.ts`
Expected: FAIL — cannot find module `./comment-scroll`.

- [ ] **Step 3: Write the helper**

Create `app/src/comment-scroll.ts`:

```ts
/**
 * Smoothly centers a comment's anchor element in the viewport (instant when the
 * user prefers reduced motion). The absolutely-positioned rail card follows the
 * document scroll, so centering the anchor brings both into view. No-ops for a
 * missing anchor.
 */
export function scrollCommentAnchorIntoView(
  anchor: HTMLElement | null,
  prefersReducedMotion: boolean,
): void {
  if (!anchor) return;
  anchor.scrollIntoView({
    behavior: prefersReducedMotion ? "auto" : "smooth",
    block: "center",
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/comment-scroll.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/comment-scroll.ts app/src/comment-scroll.test.ts
git commit -m "feat: add scrollCommentAnchorIntoView helper"
```

---

## Task 2: Scroll to a comment on click, and on add (PageCard)

**Files:**
- Modify: `app/src/PageCard.tsx`

Context: `findCommentAnchorElement(editor, commentId)` already exists
(`PageCard.tsx:301`) and returns the comment's `.comment-anchor` DOM element or
null. `focusComment` is at ~`PageCard.tsx:1595`; `handleAddComment` at
~`PageCard.tsx:1225`.

- [ ] **Step 1: Add the import**

In `app/src/PageCard.tsx`, add near the other local imports:

```tsx
import { scrollCommentAnchorIntoView } from "./comment-scroll";
```

- [ ] **Step 2: Add a reduced-motion helper**

In `app/src/PageCard.tsx`, add this module-level function near the other
top-level helpers (e.g. just above `function findCommentRange(`):

```tsx
function prefersReducedMotion(): boolean {
  return Boolean(
    typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );
}
```

- [ ] **Step 3: Scroll the document when a comment is focused (issue #1)**

Replace the existing `focusComment` callback:

```tsx
  const focusComment = useCallback((commentId: string) => {
    const currentEditor = editorRef.current;
    if (!currentEditor) return;

    setSelectedCommentId(commentId);

    const range = findCommentRange(currentEditor, commentId);
    if (range) {
      currentEditor.commands.focus(undefined, { scrollIntoView: false });
      currentEditor.view.dispatch(
        currentEditor.state.tr.setSelection(
          TextSelection.create(currentEditor.state.doc, range.from, range.to),
        ),
      );
      return;
    }

    if (!findCommentAnchorElement(currentEditor, commentId)) return;

    currentEditor.commands.focus(undefined, { scrollIntoView: false });
  }, []);
```

with (adds the scroll-to-anchor in both branches):

```tsx
  const focusComment = useCallback((commentId: string) => {
    const currentEditor = editorRef.current;
    if (!currentEditor) return;

    setSelectedCommentId(commentId);

    const range = findCommentRange(currentEditor, commentId);
    if (range) {
      currentEditor.commands.focus(undefined, { scrollIntoView: false });
      currentEditor.view.dispatch(
        currentEditor.state.tr.setSelection(
          TextSelection.create(currentEditor.state.doc, range.from, range.to),
        ),
      );
      scrollCommentAnchorIntoView(
        findCommentAnchorElement(currentEditor, commentId),
        prefersReducedMotion(),
      );
      return;
    }

    if (!findCommentAnchorElement(currentEditor, commentId)) return;

    currentEditor.commands.focus(undefined, { scrollIntoView: false });
    scrollCommentAnchorIntoView(
      findCommentAnchorElement(currentEditor, commentId),
      prefersReducedMotion(),
    );
  }, []);
```

- [ ] **Step 4: Center the new comment instead of jumping to the bottom (issue #2, part A)**

In `handleAddComment`, replace the existing trailing `requestAnimationFrame`
block:

```tsx
    setSelectedCommentId(comment.id);
    setPendingFocusCommentId(comment.id);
    requestAnimationFrame(() => {
      measureLayout();
    });
  }, [measureLayout]);
```

with (scrolls the new comment's anchor to center after layout settles):

```tsx
    setSelectedCommentId(comment.id);
    setPendingFocusCommentId(comment.id);
    const newCommentId = comment.id;
    requestAnimationFrame(() => {
      measureLayout();
      scrollCommentAnchorIntoView(
        findCommentAnchorElement(editorRef.current, newCommentId),
        prefersReducedMotion(),
      );
    });
  }, [measureLayout]);
```

- [ ] **Step 5: Build + test to verify it compiles and nothing broke**

Run: `cd app && VITE_GITHUB_MODE=1 npm run build`
Expected: PASS — `tsc -b` clean, `vite build` succeeds.

Run: `cd app && npm test`
Expected: PASS — full suite green.

- [ ] **Step 6: Commit**

```bash
git add app/src/PageCard.tsx
git commit -m "feat: scroll the document to a comment on click and on add"
```

---

## Task 3: Stop the page-yank when focusing the new comment textarea (CommentEditorList)

**Files:**
- Modify: `app/src/CommentEditorList.tsx`

Context: the auto-focus effect (`CommentEditorList.tsx:174-187`) focuses the
new comment's textarea via `target.focus()`. A plain `focus()` scrolls the
focused element into view, dragging the page (issue #2, part B).

- [ ] **Step 1: Use preventScroll when focusing the new comment**

In `app/src/CommentEditorList.tsx`, in the auto-focus effect, change:

```tsx
    target.focus();
```

to:

```tsx
    target.focus({ preventScroll: true });
```

(The surrounding lines `const cursorPosition = target.value.length;` and
`target.setSelectionRange(cursorPosition, cursorPosition);` stay as-is. There is
only one `target.focus()` in this file.)

- [ ] **Step 2: Build + test**

Run: `cd app && VITE_GITHUB_MODE=1 npm run build`
Expected: PASS.

Run: `cd app && npm test`
Expected: PASS — full suite green.

- [ ] **Step 3: Commit**

```bash
git add app/src/CommentEditorList.tsx
git commit -m "fix: focus the new comment textarea without scrolling the page (preventScroll)"
```

---

## Task 4: Verification

**Files:** none (verification only)

- [ ] **Step 1: Full suite + lint**

Run: `cd app && npm test` — Expected: all green.
Run: `cd app && npx biome check src/comment-scroll.ts src/comment-scroll.test.ts src/PageCard.tsx src/CommentEditorList.tsx` — Expected: no errors (run `--write` if formatting is flagged, then re-commit).

- [ ] **Step 2: Confirm the changes are wired**

Run: `cd app && grep -n "scrollCommentAnchorIntoView\|preventScroll" src/PageCard.tsx src/CommentEditorList.tsx`
Expected: two call sites in `PageCard.tsx` (focusComment + handleAddComment) and the import; one `preventScroll` in `CommentEditorList.tsx`.

- [ ] **Step 3: Manual smoke test**

Run: `cd app && VITE_GITHUB_MODE=1 npm run dev`, open a doc with several comments.
- Click a comment in the rail → the document smoothly scrolls to center its
  highlighted text.
- Scroll to the middle of a long doc, select text, add a comment → the page does
  NOT jump to the bottom; the new comment's text/box stays centered and the
  textarea is focused for typing.

---

## Self-Review (completed by plan author)

**Spec coverage:**
- Click → smooth-centered scroll to highlight → Task 1 (helper) + Task 2 Step 3 (`focusComment`).
- Reduced-motion awareness → Task 1 (helper) + Task 2 Step 2 (`prefersReducedMotion`).
- Add → no jump to bottom → Task 3 (`preventScroll`) + Task 2 Step 4 (center the new comment).
- Helper unit-tested; integration manual → Task 1 test + Task 4 Step 3.

**Placeholder scan:** No TBD/TODO; every code step shows complete code.

**Type consistency:** `scrollCommentAnchorIntoView(anchor: HTMLElement | null, prefersReducedMotion: boolean): void` is identical across the helper (Task 1), its test (Task 1), and both call sites (Task 2). `findCommentAnchorElement(editor, commentId)` returns `HTMLElement | null`, matching the helper's first param. `prefersReducedMotion()` returns `boolean`, matching the second param.
