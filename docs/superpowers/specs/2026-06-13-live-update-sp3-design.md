# Live update & toast (SP3) — design

**Date:** 2026-06-13
**Status:** Drafted autonomously (user away); pending review on return.
**Part of:** [Agent activity log & remote instruction loop](2026-06-13-agent-activity-log-design.md) — sub-project 3 of 3 (SP1 producer + SP2 runner shipped).

> **Decisions made without the user** (they were away; adjust on review): poll
> the **activity log** (not a generic doc-sha) as the single live signal; ~10s
> interval; key auto-update off **agent replies**, so generic human edits made
> directly on GitHub are out of scope for live-sync; a new minimal in-app toast
> component (no library); auto-apply gated on an **idle** editor (not dirty, not
> saving, no open comment draft) — otherwise the existing conflict notice.

## Goal

When the SP2 runner commits a doc edit and appends its reply, the open margins
document **updates itself in place with a toast** — no reload — and the
instruction history flips to ✅ done with the agent's summary. If the user is
mid-edit, never clobber: fall back to the existing "changed on disk" notice.

## What already exists (and what's missing)

The App already has the hard part for **local/remote** modes: a watch effect
(`App.tsx`) that, on a file-change event, **auto-applies** the new content when
the editor is clean and shows a **conflict notice** when it is dirty
(`DocumentDiskChangeState` = `clean|changed|conflict|paused`, `applyDocumentPage`,
`MarkdownFileConflictError`, reload/overwrite handlers).

**The gap:** `GitHubBackend` has **no `watchMarkdownFile`**, so in hosted mode the
watch effect early-returns — there is no live update at all today. And there is
**no toast component** anywhere. SP3 fills exactly those two gaps, plus agent
attribution, while reusing the existing clean-vs-dirty apply machinery.

## Approach: one activity-log poller as the live signal

Rather than poll the document blob sha generically, SP3 polls the doc's
**activity log** (`.margins/<docPath>.activity.jsonl`) — the agent's own record.
This single signal drives everything: it tells us a new agent reply arrived, its
status, its summary, and (for `done`) the commit. One poll, agent-aware, and the
toast/summary/commit fall out naturally.

```
GitHubBackend.watchActivityLog(docPath, onChange)   poll ~10s
        │  fires onChange(entries) when the log text changes
        ▼
App: handleActivityEntries(entries)
   • pass entries down → InstructionSender history reflects live status
   • diff vs previous → newly-arrived agent replies
       for each new reply:
         status "done" + editor IDLE → fetch doc → applyDocumentPage
                                       → toast "Updated by the agent · <summary>"
         status "done" + editor BUSY → setDiskChangeState("changed")  (no clobber)
                                       → quiet notice "Agent updated — reload when ready"
         status "error"              → history shows it; subtle/no toast
```

Generic human edits made directly on GitHub web don't write an agent reply, so
they won't live-sync — acceptable: SP3 is the **agent loop**, consistent with the
parent design. (A generic doc-sha watcher can be added later if wanted.)

## Components

### `src/activity-live.ts` (pure, unit-tested)
- `findNewAgentReplies(prev: ActivityEntry[], next: ActivityEntry[]): AgentReplyEntry[]`
  — agent replies present in `next` but not `prev` (by `id`).
- `serializeForChangeCheck(entries): string` — stable string for cheap
  change-detection between polls (so the watcher only fires on real change).
- No I/O, no time — fully testable.

### `src/github-backend.ts` — `watchActivityLog`
- New method `watchActivityLog(docPath, onChange: (entries: ActivityEntry[]) => void): () => void`.
- Polls via the existing `readActivityLog(docPath)` every
  `ACTIVITY_POLL_MS` (≈10000). On the first tick it establishes a baseline and
  fires once with the current entries; thereafter fires only when
  `serializeForChangeCheck` differs from the last. Returns an unsubscribe that
  clears the timer. A failed poll is swallowed (logged) and retried next tick.
- Added to the `StorageBackend` interface as **optional**, gated by the existing
  `capabilities.activityLog`. Non-GitHub backends omit it (already
  `activityLog:false`).

### `src/Toast.tsx` (new, minimal)
- Presentational. Props `{ message, commitUrl?, onDismiss }`. A single soft-tinted
  card pinned bottom-right (warm palette to match the app), a short message, an
  optional "view commit ↗" link, a dismiss ✕, and auto-dismiss after
  `TOAST_MS` (≈6000) via a timer the component owns. Light + dark. No external lib.
- App holds `const [toast, setToast] = useState<ToastState | null>(null)` and
  renders `<Toast>` when set.

### `src/App.tsx` — wiring (reuses existing apply/dirty machinery)
- A new effect subscribes to `backend.watchActivityLog(activeDocumentPath, …)`
  when `backend?.capabilities.activityLog && activeDocumentPath`. It keeps the
  previous entries in a ref to diff.
- `handleActivityEntries(entries)`:
  1. `setLiveActivityEntries(entries)` — passed down to InstructionSender.
  2. `const fresh = findNewAgentReplies(prevRef.current, entries)`; update
     `prevRef`.
  3. For each `done` reply: read editor state via
     `documentSession.getSnapshot()`. **Idle** = `!dirty && saveState !== "saving"
     && saveState !== "unsaved"` **and** no open comment draft (see below). If
     idle → `getMarkdownFile` + `applyDocumentPage` + `documentSession.setDirty(false)`
     + `setDocumentDiskChangeState("clean")` + `setToast({ message: "Updated by the
     agent · " + summary, commitUrl })`. If busy →
     `setDocumentDiskChangeState("changed")` (the existing notice handles the rest)
     + a quiet toast.
- The doc fetch reuses `getMarkdownFile`/`applyDocumentPage`; the busy path reuses
  the existing conflict UI verbatim (no new conflict surface).

### "No open comment draft" (don't clobber a comment being written)
The user's hard requirement: never delete a comment in flight. `documentSession.dirty`
covers body edits, but a comment being **composed** may not flip it. SP3 adds a
small read-only signal — `documentSession.getSnapshot().composingComment` (or an
equivalent already exposed by the comment editor) — and treats it as **busy**. If
no such signal exists, SP3 adds a minimal `setComposingComment(boolean)` to the
session store, set true while a comment/reply editor is open with unsaved text.
The auto-apply idle-check includes it.

### `src/DocumentWorkspace.tsx` + `src/InstructionSender.tsx` — live history
- App passes `liveActivityEntries` (and the existing `readActivityLog`) down to
  InstructionSender via DocumentWorkspace.
- InstructionSender prefers `liveActivityEntries` when present (so the history
  thread updates the instant a poll lands), falling back to its own initial load
  on mount. The send flow still appends + reloads as today; the live entries just
  keep it fresh between sends. `buildConversation` already derives status, so a
  `done`/`error` reply flips the badge automatically.

## Error handling

- Poll failures (network/rate-limit/404): swallowed and retried next tick; a 404
  log = empty (no instructions yet). The watcher never throws into React.
- Doc fetch failure during auto-apply: logged; leave the doc as-is and show a
  toast "Agent updated — couldn't refresh, reload to see it" so the user isn't
  left stale-but-silent.
- Unmount/path-change: the effect's cleanup clears the timer; in-flight callbacks
  guard on `disposed` and the current path (mirrors the existing watch effect).

## Testing

- **Unit (`activity-live.test.ts`):** `findNewAgentReplies` (new reply detected;
  already-seen ignored; user entries ignored; multiple new); `serializeForChangeCheck`
  stability (same entries → same string; appended reply → different).
- **`github-backend.test.ts`:** `watchActivityLog` polls `readActivityLog`, fires
  on change only, and the unsubscribe stops polling (fake timers + mocked fetch,
  like the existing backend tests).
- **`Toast.test.tsx`:** renders message + commit link; dismiss calls `onDismiss`;
  auto-dismiss fires after `TOAST_MS` (fake timers). `createRoot` pattern.
- **App-level (where feasible with the existing harness):** a `done` reply on an
  idle editor applies the new content + sets a toast; on a dirty editor sets
  `changed` and does **not** change content. (Follow the existing App/watch test
  patterns; jsdom can't render the real editor, so assert via the session store +
  state, not pixels.)
- **Live verification on `/preview` or a real doc:** trigger the SP2 runner (or
  hand-append an agent reply + commit a doc change) and watch the open doc toast +
  update; then repeat while mid-edit and confirm the conflict notice instead.

## Out of scope (YAGNI / later)

- Live-syncing generic human edits made directly on GitHub (no agent reply → no
  signal). A generic doc-sha `watchMarkdownFile` for GitHub could add this later.
- WebSocket/push; polling only (matches SP2).
- Multi-doc / background-tab live updates beyond the open doc.
- Merging agent edits into a dirty buffer (we show the conflict notice; the user
  chooses reload/keep — the existing flow).
- A full toast queue/stack — one toast at a time (latest wins) is enough.

## Delivery

`feat/live-update-sp3`. Spec → plan → subagent-driven implementation → PR →
merge → pull `main`. A deploy (`wrangler pages deploy`) makes it live for the
hosted app — but only on the user's explicit ask, per standing preference.
