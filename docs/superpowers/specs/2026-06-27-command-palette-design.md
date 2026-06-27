# REC-504 — Command palette (⌘K)

**Status:** Design (autonomous Amadeus run; PR is the review gate)
**Date:** 2026-06-27
**Linear:** REC-504 (part of REC-497 "Ideas for improvements", theme *Navigation & discovery*)

## Problem

Common actions — open a file, switch branch/repo, toggle suggesting mode, share,
save, toggle theme — require hunting through the UI. There is no keyboard-first
way to reach them.

## Goal / acceptance criteria

- `⌘K` (and `Ctrl+K`) opens a palette that can:
  - Quick-open markdown files (fuzzy-matched).
  - Switch branch / switch repo.
  - Run commands: toggle suggesting mode, open share, save, toggle theme.
- Keyboard-first, fuzzy-matched, accessible.

## Scope decisions (YAGNI)

- **Editor-scoped.** The palette lives in `DocumentWorkspace`, so it is available
  whenever a document is open. The picker screen (`GitHubPicker`) already *is* a
  repo/branch/file selector, so we do not add a second palette there.
- **No new dependency.** Built on the existing `@base-ui/react` `Dialog`
  primitive plus a small, unit-tested pure module — matching the codebase's
  headless-primitive house style. We deliberately avoid adding `cmdk`.
- **GitHub-only commands degrade gracefully.** File-open and branch/repo switching
  require the GitHub backend (`backend.listMarkdownPaths`, `githubNav`). When the
  backend is local/public these commands are simply omitted; theme/save/suggesting
  still work where applicable.

## Architecture

Three units, each independently testable:

### 1. `command-palette.ts` (pure, no React)

The model + filtering logic. No DOM, no async — trivially unit-testable.

```ts
export interface PaletteCommand {
  id: string;
  title: string;            // "Toggle suggesting mode"
  group: "Files" | "Actions" | "Branches" | "Repositories";
  keywords?: string[];      // extra fuzzy-match terms ("dark", "light")
  hint?: string;            // right-aligned hint, e.g. current value
}

// Subsequence fuzzy match with a relevance score (contiguous + word-boundary
// + prefix bonuses). Returns null when `query` is not a subsequence of `text`.
export function fuzzyScore(text: string, query: string): number | null;

// Filter + sort a command list by a query. Empty query returns the input order
// (callers cap file lists before passing them in).
export function filterCommands<T extends PaletteCommand>(
  commands: T[],
  query: string,
): T[];
```

Ranking: exact > prefix > word-boundary subsequence > scattered subsequence;
ties broken by shorter target then original order (stable).

### 2. `CommandPalette.tsx` (presentational + interaction)

A controlled component. Owns no business logic; receives the command list and an
`onRun` callback. Responsibilities:

- Render a modal `Dialog` with a search `input` and a grouped, filtered list.
- Keyboard: `↑/↓` move the active item, `Enter` runs it, `Esc`/overlay-click and
  re-pressing `⌘K` close it, typing filters via `filterCommands`.
- ARIA combobox/listbox semantics (`role="listbox"`, `aria-activedescendant`).
- **Pages.** The palette has a current "page". The root page lists Actions (+
  Files once the user types). A command may, instead of executing, *push a page*
  (e.g. "Switch branch…" pushes an async-loaded Branches page). `Esc`/Backspace
  on an empty query pops back to root. This keeps branch/repo pickers inside the
  one palette instead of spawning extra dialogs.

```tsx
interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rootCommands: PaletteCommand[];
  // Returns the items for a pushed page (async: branches/repos/files fetch).
  loadPage?: (pageId: string) => Promise<PaletteCommand[]>;
  onRun: (commandId: string) => void; // may set state that pushes a page
}
```

(The exact page mechanism is an implementation detail; the contract is: one
dialog, fuzzy filter, keyboard nav, async sub-pages.)

### 3. Wiring in `DocumentWorkspace.tsx`

`DocumentWorkspace` already holds or receives everything the commands need, so it
builds the command list and the `onRun` handler and renders `<CommandPalette>`:

| Command | Action |
| --- | --- |
| Open file… | `backend.listMarkdownPaths()` → fuzzy list → `onNavigate(gitHubHref({...githubNav, path}))` |
| Switch branch… | `listBranches(token, owner, repo)` → `onNavigate(gitHubHref({owner, repo, branch, path}))` |
| Switch repo… | `listAccessibleRepos(token)` → `onNavigate(gitHubHref({owner, repo, branch: defaultBranch}))` |
| Toggle suggesting mode | `setDocumentInteractionMode(mode === "suggesting" ? "editing" : "suggesting")` |
| Open share | open the (now controllable) `SharePopover` |
| Save | `documentSession.getSnapshot().saveController?.flushSave()` |
| Toggle theme | `setTheme(currentTheme() === "dark" ? "light" : "dark")` |

- A single global `keydown` listener (added by `CommandPalette` while mounted)
  toggles `open` on `(metaKey || ctrlKey) && key === "k"`, calling
  `event.preventDefault()`. `⌘K` is not otherwise bound in the app, so no
  conflict handling is needed.
- **Navigation safety:** file/branch/repo commands route through the existing
  `onNavigate` prop (`App.handleNavigateAway`), which already prompts on unsaved
  changes — no new data-loss path.
- **Share control:** `SharePopover` gains optional `open` / `onOpenChange` props.
  When omitted it stays uncontrolled (current behaviour). `DocumentWorkspace`
  owns a `shareOpen` state so the palette can open it. Share is only listed when
  `backend.info.kind === "github"`, mirroring the existing render guard.
- Commands are filtered to what's applicable: file/branch/repo/share only in
  GitHub mode; suggesting mode hidden when `readOnly` (public docs).

## Data flow

```
⌘K → CommandPalette opens (root: Actions; + Files as user types)
   → user types → filterCommands() ranks Actions + (capped) Files
   → Enter on a "page" command → loadPage() fetches branches/repos/files async
   → Enter on a leaf command → onRun(id) → DocumentWorkspace runs the action
   → palette closes (except where staying open makes sense, e.g. errors)
```

## Error handling

- `listMarkdownPaths` / `listBranches` / `listAccessibleRepos` are network calls.
  On failure the relevant page shows an inline "Couldn't load…" empty state; the
  palette stays open. Failures are caught locally (no uncaught rejections).
- Missing token (`getStoredToken()` null) → GitHub-only pages are not offered.
- Running an action that itself throws is surfaced through the existing channels
  (e.g. save errors already flow through `documentSession`/toast).

## Testing

- **Unit (vitest):** `command-palette.test.ts` covers `fuzzyScore`
  (subsequence/no-match, prefix vs scattered ordering, case-insensitivity) and
  `filterCommands` (ranking order, empty query passthrough, stability).
- **Component (vitest + jsdom):** `CommandPalette.test.tsx` covers: opens on
  `⌘K`, typing filters, `↑/↓` + `Enter` runs the active command via `onRun`,
  `Esc` closes, and pushing/popping a page.
- Manual smoke (in PR notes): each of the seven commands end-to-end in GitHub mode.

## Files

- New: `app/src/command-palette.ts`, `app/src/command-palette.test.ts`
- New: `app/src/CommandPalette.tsx`, `app/src/CommandPalette.test.tsx`
- Edit: `app/src/DocumentWorkspace.tsx` (build commands, render palette, share state)
- Edit: `app/src/SharePopover.tsx` (optional controlled `open`/`onOpenChange`)

## Open questions (flagged for human review on the PR / Linear)

1. **Scope of branch/repo switching** — included per the issue. If the reviewer
   wants a smaller first cut, these are the easiest to drop (they're separate
   pages).
2. **Empty-query file listing** — chosen: show only Actions until the user types,
   then include files. Alternative: show recent/current-folder files immediately.
