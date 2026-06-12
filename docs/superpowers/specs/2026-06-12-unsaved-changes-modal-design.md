# Unsaved-changes modal — design

**Date:** 2026-06-12
**Status:** Approved, pending implementation
**Branch:** `feat/unsaved-changes-modal`

## Summary

Replace the native `window.confirm("You have unsaved changes that will be lost.
Leave this document?")` that fires on in-app navigation away from a dirty
document with a proper, styled in-app modal offering three choices: **Commit &
leave**, **Leave without saving**, and **Stay**.

## Scope

- **In scope:** the in-app navigation confirm in `handleNavigateAway`
  (`App.tsx:601`) — fired by breadcrumb / back-to-picker / folder navigation
  while the open document has uncommitted changes.
- **Out of scope (cannot be changed):** the browser's native `beforeunload`
  warning on real tab-close / refresh (`App.tsx:417`). Browsers force their own
  generic dialog there; custom UI is not possible. It stays exactly as-is.
- **Out of scope (YAGNI):** a "don't ask again" option; a toast/banner variant.

## Decisions (resolved during brainstorming)

| Question | Decision |
|----------|----------|
| Keep the native tab-close/refresh warning? | Yes — it can't be customized; only the in-app nav confirm becomes a modal. |
| Modal actions | Three: **Commit & leave**, **Leave without saving**, **Stay**. |

## Background: how committing works

- The open document's save/dirty state lives in `documentSession`
  (`document-session.ts`), exposing `getSnapshot()` with `saveState`, `dirty`,
  and a `saveController`.
- `saveController.flushSave(): Promise<ManualSaveResult>` performs the commit
  (the "Commit changes" button calls it). `ManualSaveResult` is
  `{ status: "saved" } | { status: "blocked" } | { status: "error"; error }`.
- `shouldWarnBeforeUnload({...})` (already in `App.tsx`, already unit-tested) is
  the single predicate deciding whether unsaved work would be lost.
- `handleNavigateAway(href)` is the single funnel for in-app navigation away
  from the document (passed to `DocumentWorkspace` as `onNavigate`).

## Architecture & flow

The native `confirm` is synchronous; a modal is async. So instead of branching
inline on a boolean, we hold the pending navigation target in state and resolve
it when the user picks a button.

```
DocumentWorkspace breadcrumb / back-to-picker
   │  onNavigate(href)
   ▼
App.handleNavigateAway(href)
   │  shouldWarnBeforeUnload(...) ?
   ├─ no  → navigate(href)                         (unchanged fast path)
   └─ yes → setPendingNavHref(href)  → opens <UnsavedChangesDialog>
                   │
        ┌──────────┼─────────────────────────┐
        ▼          ▼                          ▼
   Commit & leave   Leave without saving      Stay / dismiss
        │                │                       │
 flushSave()        navigate(href)          clear pending state
   ├ "saved"  → navigate(href), close
   ├ "error"  → show error inline, stay open
   └ "blocked"→ show conflict message, stay open
```

## Components & changes

### New: `src/UnsavedChangesDialog.tsx`
Presentational modal built on the existing `components/ui/dialog` primitives
(same styling as the New File dialog). Props:

- `open: boolean`
- `manualCommit: boolean` — primary button label: `"Commit & leave"` when true,
  `"Save & leave"` otherwise.
- `committing: boolean` — disables all buttons; primary shows `"Committing…"`.
- `error: string | null` — rendered inline (rose text) when present.
- `onCommitAndLeave: () => void`
- `onLeaveWithoutSaving: () => void`
- `onStay: () => void` — also used for `onOpenChange` close.

Layout: title "Unsaved changes"; body "You have changes that haven't been
committed. Commit them before leaving, or leave without saving?"; footer
buttons **Stay** (outline) · **Leave without saving** (outline/destructive
tone) · primary commit button.

### `src/App.tsx`
- New state: `pendingNavHref: string | null`, `committingBeforeLeave: boolean`,
  `leaveError: string | null`.
- `handleNavigateAway(href)`: if `shouldWarnBeforeUnload(...)` →
  `setPendingNavHref(href)` (open modal); else `navigate(href)`.
- `handleCommitAndLeave()`: `setCommittingBeforeLeave(true)`, clear error,
  `const result = await documentSession.getSnapshot().saveController?.flushSave()`:
  - `result?.status === "saved"` → `navigate(pendingNavHref)`, clear pending +
    committing.
  - `result?.status === "error"` → set `leaveError` from the error, clear
    committing, keep open.
  - `result?.status === "blocked"` → set `leaveError` to a conflict message
    ("This file changed on disk — resolve the conflict before committing."),
    clear committing, keep open.
  - `result` undefined (no controller) → fall back to navigate (nothing to
    commit).
- `handleLeaveWithoutSaving()`: capture href, clear pending state, `navigate(href)`.
- `handleStayOnDocument()`: clear `pendingNavHref`, `leaveError`,
  `committingBeforeLeave`.
- Render `<UnsavedChangesDialog open={!!pendingNavHref} manualCommit={...} .../>`
  in the document-workspace branch (where `saveController` exists).
- Remove the `window.confirm` block from `handleNavigateAway`.

### Unchanged
The `beforeunload` handler (native tab-close/refresh warning) is left exactly
as-is.

## Error handling

- Commit failure (`error`) or disk conflict (`blocked`) keep the dialog open
  with an inline message; the user can retry, leave without saving, or stay.
- Dismissing the dialog (Escape / backdrop / Stay) cancels the pending
  navigation and clears any committing/error state.

## Testing

- **`UnsavedChangesDialog.test.tsx`** (component test, `createRoot` pattern like
  `GitHubPicker.test.tsx`): renders the three buttons; clicking each fires the
  matching handler; `committing` disables the buttons and the primary reads
  "Committing…"; `error` text renders; `manualCommit` toggles the primary label.
- `shouldWarnBeforeUnload` is already unit-tested — the decision gate is covered.

## Delivery

Implemented on `feat/unsaved-changes-modal`; PR → merge → pull `main` → deploy to
Cloudflare (same flow as prior changes).
