# Unsaved-changes Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the native `window.confirm` shown when navigating away from a dirty document with a styled in-app modal offering Commit & leave / Leave without saving / Stay.

**Architecture:** A new presentational `UnsavedChangesDialog` (built on the existing `components/ui/dialog` primitives) is driven by new App state. `handleNavigateAway` stops calling `window.confirm`; when there are unsaved changes it stashes the pending navigation target and opens the modal, whose three buttons resolve the pending navigation (committing via the existing `saveController.flushSave()` when asked). The native `beforeunload` tab-close warning is left unchanged.

**Tech Stack:** React + TypeScript, Vite, Vitest (`npm test` in `app/`), Biome. All commands run from the `app/` directory.

---

## File Structure

- **Create** `app/src/UnsavedChangesDialog.tsx` — presentational modal (open/committing/error props + three action callbacks).
- **Create** `app/src/UnsavedChangesDialog.test.tsx` — component test.
- **Modify** `app/src/App.tsx` — state + handlers + render; remove the `window.confirm`.

All work happens on the existing branch `feat/unsaved-changes-modal`.

---

## Task 1: UnsavedChangesDialog component

**Files:**
- Create: `app/src/UnsavedChangesDialog.tsx`
- Test: `app/src/UnsavedChangesDialog.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `app/src/UnsavedChangesDialog.test.tsx`:

```tsx
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  UnsavedChangesDialog,
  type UnsavedChangesDialogProps,
} from "./UnsavedChangesDialog";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function buttonByText(text: string): HTMLButtonElement | null {
  return (Array.from(document.querySelectorAll("button")).find((b) =>
    b.textContent?.includes(text),
  ) ?? null) as HTMLButtonElement | null;
}

function render(props: Partial<UnsavedChangesDialogProps> = {}) {
  const handlers = {
    onCommitAndLeave: vi.fn(),
    onLeaveWithoutSaving: vi.fn(),
    onStay: vi.fn(),
  };
  act(() => {
    root.render(
      <UnsavedChangesDialog
        open
        manualCommit
        committing={false}
        error={null}
        {...handlers}
        {...props}
      />,
    );
  });
  return handlers;
}

describe("UnsavedChangesDialog", () => {
  it("shows the three actions with the manual-commit primary label", () => {
    render({ manualCommit: true });
    expect(buttonByText("Stay")).not.toBeNull();
    expect(buttonByText("Leave without saving")).not.toBeNull();
    expect(buttonByText("Commit & leave")).not.toBeNull();
  });

  it("uses 'Save & leave' when not in manual-commit mode", () => {
    render({ manualCommit: false });
    expect(buttonByText("Save & leave")).not.toBeNull();
    expect(buttonByText("Commit & leave")).toBeNull();
  });

  it("fires the matching handler for each button", () => {
    const handlers = render();
    act(() => buttonByText("Commit & leave")?.click());
    expect(handlers.onCommitAndLeave).toHaveBeenCalledTimes(1);
    act(() => buttonByText("Leave without saving")?.click());
    expect(handlers.onLeaveWithoutSaving).toHaveBeenCalledTimes(1);
    act(() => buttonByText("Stay")?.click());
    expect(handlers.onStay).toHaveBeenCalledTimes(1);
  });

  it("disables the buttons and shows 'Committing…' while committing", () => {
    render({ committing: true });
    expect(buttonByText("Committing…")).not.toBeNull();
    expect(buttonByText("Stay")?.disabled).toBe(true);
    expect(buttonByText("Leave without saving")?.disabled).toBe(true);
    expect(buttonByText("Committing…")?.disabled).toBe(true);
  });

  it("renders an inline error when provided", () => {
    render({ error: "Commit failed (500)" });
    expect(document.body.textContent).toContain("Commit failed (500)");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/UnsavedChangesDialog.test.tsx`
Expected: FAIL — cannot find module `./UnsavedChangesDialog`.

- [ ] **Step 3: Write the component**

Create `app/src/UnsavedChangesDialog.tsx`:

```tsx
import { Button } from "./components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";

export interface UnsavedChangesDialogProps {
  open: boolean;
  /** GitHub backends commit manually; the primary label reflects that. */
  manualCommit: boolean;
  /** True while a commit-and-leave is in flight; disables all actions. */
  committing: boolean;
  /** Inline error from a failed commit attempt, if any. */
  error: string | null;
  onCommitAndLeave: () => void;
  onLeaveWithoutSaving: () => void;
  onStay: () => void;
}

export function UnsavedChangesDialog({
  open,
  manualCommit,
  committing,
  error,
  onCommitAndLeave,
  onLeaveWithoutSaving,
  onStay,
}: UnsavedChangesDialogProps) {
  const commitLabel = manualCommit ? "Commit & leave" : "Save & leave";
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Dismissing (Escape / backdrop) cancels the pending navigation, but
        // not while a commit is mid-flight.
        if (!next && !committing) onStay();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Unsaved changes</DialogTitle>
          <DialogDescription>
            You have changes that haven't been committed. Commit them before
            leaving, or leave without saving?
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onStay}
            disabled={committing}
          >
            Stay
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onLeaveWithoutSaving}
            disabled={committing}
          >
            Leave without saving
          </Button>
          <Button
            type="button"
            onClick={onCommitAndLeave}
            disabled={committing}
          >
            {committing ? "Committing…" : commitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/UnsavedChangesDialog.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/UnsavedChangesDialog.tsx app/src/UnsavedChangesDialog.test.tsx
git commit -m "feat: add UnsavedChangesDialog component"
```

---

## Task 2: Wire the modal into App and remove the confirm

**Files:**
- Modify: `app/src/App.tsx`

- [ ] **Step 1: Add the import**

In `app/src/App.tsx`, add this import next to the other local imports (e.g. just below the `import { resolveAppView } from "./app-view";` line):

```tsx
import { UnsavedChangesDialog } from "./UnsavedChangesDialog";
```

- [ ] **Step 2: Add state**

In `App()`, directly below the existing `const [loadError, setLoadError] = useState<string | null>(null);` line, add:

```tsx
  const [pendingNavHref, setPendingNavHref] = useState<string | null>(null);
  const [committingBeforeLeave, setCommittingBeforeLeave] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);
```

- [ ] **Step 3: Replace `handleNavigateAway` (remove the `window.confirm`)**

Replace the entire existing `handleNavigateAway` definition:

```tsx
  const handleNavigateAway = useCallback(
    (href: string) => {
      const session = documentSession.getSnapshot();
      if (
        shouldWarnBeforeUnload({
          activeDocumentPath: activeDocumentPathRef.current,
          isDirty: session.dirty,
          saveState: session.saveState,
          diskChangeState: documentDiskChangeState,
        }) &&
        !window.confirm(
          "You have unsaved changes that will be lost. Leave this document?",
        )
      ) {
        return;
      }
      navigate(href);
    },
    [documentSession, documentDiskChangeState],
  );
```

with this (opens the modal instead of calling `confirm`):

```tsx
  const handleNavigateAway = useCallback(
    (href: string) => {
      const session = documentSession.getSnapshot();
      if (
        shouldWarnBeforeUnload({
          activeDocumentPath: activeDocumentPathRef.current,
          isDirty: session.dirty,
          saveState: session.saveState,
          diskChangeState: documentDiskChangeState,
        })
      ) {
        setLeaveError(null);
        setPendingNavHref(href);
        return;
      }
      navigate(href);
    },
    [documentSession, documentDiskChangeState],
  );

  const handleStayOnDocument = useCallback(() => {
    setPendingNavHref(null);
    setLeaveError(null);
    setCommittingBeforeLeave(false);
  }, []);

  const handleLeaveWithoutSaving = useCallback(() => {
    const href = pendingNavHref;
    setPendingNavHref(null);
    setLeaveError(null);
    setCommittingBeforeLeave(false);
    if (href) navigate(href);
  }, [pendingNavHref]);

  const handleCommitAndLeave = useCallback(async () => {
    const href = pendingNavHref;
    if (!href) return;
    const controller = documentSession.getSnapshot().saveController;
    if (!controller) {
      // No editor controller to commit through — just leave.
      handleLeaveWithoutSaving();
      return;
    }
    setCommittingBeforeLeave(true);
    setLeaveError(null);
    const result = await controller.flushSave();
    if (result.status === "saved") {
      setCommittingBeforeLeave(false);
      setPendingNavHref(null);
      navigate(href);
      return;
    }
    setCommittingBeforeLeave(false);
    setLeaveError(
      result.status === "blocked"
        ? "This file changed on disk — resolve the conflict before committing."
        : result.error instanceof Error
          ? result.error.message
          : "Could not commit your changes.",
    );
  }, [pendingNavHref, documentSession, handleLeaveWithoutSaving]);
```

- [ ] **Step 4: Render the dialog in the workspace branch**

In `app/src/App.tsx`, the workspace `return (` renders `<main>…</main>`. Add the dialog as the last child inside `<main>`, immediately after the closing `</Suspense>` and before `</main>`:

```tsx
      <UnsavedChangesDialog
        open={pendingNavHref !== null}
        manualCommit={backend?.capabilities.manualCommit ?? false}
        committing={committingBeforeLeave}
        error={leaveError}
        onCommitAndLeave={handleCommitAndLeave}
        onLeaveWithoutSaving={handleLeaveWithoutSaving}
        onStay={handleStayOnDocument}
      />
```

- [ ] **Step 5: Build + test to verify it compiles and nothing broke**

Run: `cd app && VITE_GITHUB_MODE=1 npm run build`
Expected: PASS — `tsc -b` clean (no unused-var or type errors), `vite build` succeeds.

Run: `cd app && npm test`
Expected: PASS — full suite green, including the new `UnsavedChangesDialog` tests.

- [ ] **Step 6: Commit**

```bash
git add app/src/App.tsx
git commit -m "feat: replace unsaved-changes confirm with the UnsavedChangesDialog modal"
```

---

## Task 3: Verification

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `cd app && npm test`
Expected: PASS — entire suite green.

- [ ] **Step 2: Lint**

Run: `cd app && npx biome check src/UnsavedChangesDialog.tsx src/UnsavedChangesDialog.test.tsx src/App.tsx`
Expected: no errors. (If formatting is flagged, run `npx biome check --write` on those files and re-commit.)

- [ ] **Step 3: Confirm the native warning is untouched**

Run: `cd app && grep -n "beforeunload\|window.confirm" src/App.tsx`
Expected: the `beforeunload` handler is still present; there is NO remaining `window.confirm`.

- [ ] **Step 4: Manual smoke test (optional)**

Run: `cd app && VITE_GITHUB_MODE=1 npm run dev`, open a GitHub markdown file, edit it (don't commit), then click the breadcrumb / back-to-picker. Confirm: the styled modal appears (not the native popup); **Commit & leave** commits then navigates; **Leave without saving** navigates immediately; **Stay** closes and keeps you on the doc. Then confirm a browser refresh with unsaved changes still shows the native tab-close warning.

---

## Self-Review (completed by plan author)

**Spec coverage:**
- Styled modal replacing the in-app confirm → Task 1 (component) + Task 2 (wiring, removal of `window.confirm`).
- Three actions (Commit & leave / Leave without saving / Stay) → Task 1 buttons + Task 2 handlers.
- Commit via existing `saveController.flushSave()`, handling `saved`/`error`/`blocked` → Task 2 `handleCommitAndLeave`.
- Primary label depends on `manualCommit` → Task 1 (`commitLabel`).
- Native `beforeunload` left unchanged → not touched; verified in Task 3 Step 3.
- Tests mirroring `createRoot` pattern → Task 1 test.

**Placeholder scan:** No TBD/TODO; every code step shows complete code.

**Type consistency:** `UnsavedChangesDialogProps` (open, manualCommit, committing, error, onCommitAndLeave, onLeaveWithoutSaving, onStay) is identical across the component (Task 1), its test (Task 1), and the App render (Task 2). `ManualSaveResult.status` values (`"saved"`/`"blocked"`/`"error"`) match `flushSave`'s contract used in Task 2. The async `handleCommitAndLeave` (`() => Promise<void>`) is assignable to the prop `onCommitAndLeave: () => void`.
